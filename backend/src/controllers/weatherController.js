const Road = require('../models/Road');
const WeatherObservation = require('../models/WeatherObservation');
const { success, failure } = require('../utils/response');
const { findWeatherForRoad } = require('../services/weatherRoadService');
const { extractRiskFeaturesFromWeather } = require('../services/weatherRiskAdapter');
const { classifyFreshness } = require('../services/freshnessService');
const { getAwsWeather, hasCredentials } = require('../services/weatherService');
const weatherApiService = require('../services/weatherApiService');
const { registerSource } = require('../services/dataSourceRegistry');
const { calculateRisk } = require('../services/riskService');

// Active provider selection (see WEATHER_PROVIDER.md). Defaults to
// 'weatherapi' because IMD credentials are not obtainable for this
// project (IMD_ACCESS = NOT_VERIFIED — see IMD_INTEGRATION.md); IMD
// remains fully wired and can be reactivated with WEATHER_PROVIDER=imd
// the moment real credentials exist. This is the ONE place that decides
// which provider's ingestion/read path is active.
//
// Read live (not cached at module load) — same principle as
// weatherService.hasCredentials() re-reading process.env every call —
// so both a real server restart and a test's `withEnv` helper take
// effect immediately.
function getActiveProvider() {
  return (process.env.WEATHER_PROVIDER || 'weatherapi').toLowerCase();
}

function activeProviderHasCredentials() {
  return getActiveProvider() === 'imd' ? hasCredentials() : weatherApiService.hasCredentials();
}

function activeProviderUnavailableReason() {
  if (getActiveProvider() === 'imd') {
    return hasCredentials() ? 'no observation within range' : 'IMD credentials not configured — see IMD_INTEGRATION.md';
  }
  return weatherApiService.hasCredentials()
    ? 'no observation within range'
    : 'WeatherAPI credentials not configured — see WEATHER_PROVIDER.md';
}

// GET /api/weather/road/:roadId
// Returns the nearest weather observation for a road (if any exists),
// its freshness classification, and the risk-engine features it would
// contribute — WITHOUT claiming weather was measured on the road itself.
async function getWeatherForRoad(req, res) {
  const road = await Road.findById(req.params.roadId);
  if (!road) return failure(res, 'Road not found', 404);

  const match = await findWeatherForRoad(road);

  if (!match) {
    const { riskInput, explanation } = extractRiskFeaturesFromWeather(null, {
      rainfallScore: road.floodRisk,
      slopeScore: road.landslideRisk,
      historicalRisk: 30,
      roadCondition: 25,
    });
    return success(res, {
      roadId: road.id,
      weather: null,
      freshness: 'UNAVAILABLE',
      reason: activeProviderUnavailableReason(),
      riskInput,
      explanation,
    });
  }

  const observation = match.observation.toJSON ? match.observation.toJSON() : match.observation;
  const freshness = classifyFreshness({
    observedAt: observation.observedAt,
    receivedAt: observation.receivedAt,
    hasCredentials: activeProviderHasCredentials(),
  });

  const { riskInput, explanation } = extractRiskFeaturesFromWeather(observation, {
    rainfallScore: road.floodRisk,
    slopeScore: road.landslideRisk,
    historicalRisk: 30,
    roadCondition: 25,
  });

  const risk = calculateRisk(riskInput);

  return success(res, {
    roadId: road.id,
    weather: observation,
    distanceToStationKm: match.distanceKm,
    matchConfidence: match.confidence,
    freshness,
    riskInput,
    riskResult: risk,
    explanation,
  });
}

/**
 * Persists one normalized AWS/ARG observation: upsert by
 * (source, sourceRecordId, observedAt) — the same idempotency key as the
 * model's unique index — so re-fetching the same station reading updates
 * rather than duplicates. `sourceStatus: 'LIVE'` here records that this
 * row came from a request that succeeded just now; STALE/CACHED
 * classification for CONSUMERS of this row is computed dynamically by
 * freshnessService at read time (see getWeatherForRoad above), not
 * frozen into the stored document.
 */
async function persistObservation(normalized) {
  const filter = {
    source: normalized.source,
    sourceRecordId: normalized.sourceRecordId,
    observedAt: normalized.observedAt,
  };
  await WeatherObservation.findOneAndUpdate(
    filter,
    { $set: { ...normalized, receivedAt: new Date(), sourceStatus: 'LIVE' } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

/**
 * One IMD weather ingestion pass: fetches the AWS/ARG reading (the only
 * one of the three modeled endpoints that returns real station
 * coordinates, required for weatherRoadService's spatial association)
 * for each configured station and persists successful, validated
 * results. Never fabricates a WeatherObservation — a station that fails
 * to fetch or normalize simply contributes no row, same as Phase 2's
 * documented failure behavior in IMD_INTEGRATION.md.
 *
 * `stationIds` must be real IMD AWS/ARG station IDs (see
 * IMD_STATION_IDS in .env.example) — never invented here.
 *
 * `persistFn` is injectable (defaults to the real `persistObservation`)
 * so tests can exercise this function's fetch/normalize/gating logic
 * without ever opening a MongoDB connection — same principle as
 * `fetchFn` in weatherService.js, applied to the write side.
 */
async function runWeatherIngestion(stationIds = [], { fetchFn, persistFn = persistObservation } = {}) {
  if (!hasCredentials()) {
    registerSource('IMD_WEATHER', {
      status: 'UNAVAILABLE',
      source: 'IMD AWS/ARG Data API (api.imd.gov.in)',
      coverage: 'Not attempted — no IMD_API_KEY configured',
      confidence: null,
      error: 'No credentials. Registration requires an official .gov.in/.nic.in/.cdot.in/.cdac.in/.nhai.org/.icar.org.in email — see IMD_INTEGRATION.md',
    });
    return { status: 'UNAVAILABLE', persisted: 0, total: 0, errors: ['no_credentials'] };
  }

  if (!stationIds.length) {
    registerSource('IMD_WEATHER', {
      status: 'UNAVAILABLE',
      source: 'IMD AWS/ARG Data API (api.imd.gov.in)',
      coverage: 'Not attempted — no IMD_STATION_IDS configured',
      confidence: null,
      error: 'Credentials configured but no station IDs set — see IMD_INTEGRATION.md "Geographic limitations"',
    });
    return { status: 'UNAVAILABLE', persisted: 0, total: 0, errors: ['no_stations_configured'] };
  }

  let persisted = 0;
  const errors = [];

  for (const stationId of stationIds) {
    const result = await getAwsWeather(stationId, { fetchFn });
    if (result.status === 'LIVE' && result.observation) {
      try {
        await persistFn(result.observation);
        persisted += 1;
      } catch (err) {
        errors.push({ stationId, reason: err.message });
      }
    } else {
      errors.push({ stationId, reason: result.error });
    }
  }

  registerSource('IMD_WEATHER', {
    status: persisted > 0 ? 'LIVE' : 'UNAVAILABLE',
    source: 'IMD AWS/ARG Data API (api.imd.gov.in)',
    coverage: `${persisted}/${stationIds.length} configured station(s)`,
    confidence: persisted > 0 ? 0.85 : null,
    error: persisted === 0 ? errors[0]?.reason || 'no successful fetches' : null,
  });

  return { status: persisted > 0 ? 'LIVE' : 'UNAVAILABLE', persisted, total: stationIds.length, errors };
}

/**
 * Derives representative polling locations for WeatherAPI ingestion from
 * the road network already in the DB — the road's own representative
 * coordinates (see Road.lat/lng), never an invented or user-GPS point.
 * Coordinates are rounded to 1 decimal place (~11km) so closely-spaced
 * road segments share a single poll instead of each segment generating
 * its own API call; that's well within weatherRoadService's own
 * HIGH-confidence radius (25km), so it doesn't change which reading a
 * road ends up matched to at read time.
 */
async function getWeatherPollingLocations() {
  const roads = await Road.find({ lat: { $ne: null }, lng: { $ne: null } }, 'lat lng name').lean();
  const seen = new Map();
  for (const road of roads) {
    if (typeof road.lat !== 'number' || typeof road.lng !== 'number') continue;
    const key = `${road.lat.toFixed(1)},${road.lng.toFixed(1)}`;
    if (!seen.has(key)) seen.set(key, { lat: road.lat, lng: road.lng, label: road.name || key });
  }
  return Array.from(seen.values());
}

/**
 * One WeatherAPI.com ingestion pass: fetches current weather for each
 * polling location and persists successful, validated results. Mirrors
 * `runWeatherIngestion`'s gating/error/idempotency discipline exactly,
 * but targets coordinates (WeatherAPI is coordinate-based) instead of
 * IMD station IDs, and registers under a distinct data-source key
 * ('WEATHERAPI_WEATHER') so the UI never conflates a third-party fetch
 * with IMD's — see WEATHER_PROVIDER.md.
 */
async function runWeatherApiIngestion(locations = [], { fetchFn, persistFn = persistObservation } = {}) {
  if (!weatherApiService.hasCredentials()) {
    registerSource('WEATHERAPI_WEATHER', {
      status: 'UNAVAILABLE',
      source: 'WeatherAPI.com Current Weather API (third-party, not an official government feed)',
      coverage: 'Not attempted — no WEATHERAPI_API_KEY configured',
      confidence: null,
      error: 'No credentials. Set WEATHERAPI_API_KEY in backend/.env — see WEATHER_PROVIDER.md',
    });
    return { status: 'UNAVAILABLE', persisted: 0, total: 0, errors: ['no_credentials'] };
  }

  if (!locations.length) {
    registerSource('WEATHERAPI_WEATHER', {
      status: 'UNAVAILABLE',
      source: 'WeatherAPI.com Current Weather API (third-party, not an official government feed)',
      coverage: 'Not attempted — no NER road locations available to poll',
      confidence: null,
      error: 'No road locations found — import the road network before weather ingestion can run',
    });
    return { status: 'UNAVAILABLE', persisted: 0, total: 0, errors: ['no_locations_configured'] };
  }

  let persisted = 0;
  const errors = [];

  for (const location of locations) {
    const result = await weatherApiService.getCurrentWeather(location.lat, location.lng, { fetchFn });
    if (result.status === 'LIVE' && result.observation) {
      try {
        await persistFn(result.observation);
        persisted += 1;
      } catch (err) {
        errors.push({ location: location.label || `${location.lat},${location.lng}`, reason: err.message });
      }
    } else {
      errors.push({ location: location.label || `${location.lat},${location.lng}`, reason: result.error });
    }
  }

  registerSource('WEATHERAPI_WEATHER', {
    status: persisted > 0 ? 'LIVE' : 'UNAVAILABLE',
    source: 'WeatherAPI.com Current Weather API (third-party, not an official government feed)',
    coverage: `${persisted}/${locations.length} polled location(s)`,
    // Lower baseline confidence than IMD's (0.85) — WeatherAPI is a
    // third-party aggregator, not an official government station network,
    // a documented engineering judgement call, not a measured accuracy.
    confidence: persisted > 0 ? 0.7 : null,
    error: persisted === 0 ? errors[0]?.reason || 'no successful fetches' : null,
  });

  return { status: persisted > 0 ? 'LIVE' : 'UNAVAILABLE', persisted, total: locations.length, errors };
}

/**
 * The single weather ingestion scheduler entry point: chooses the
 * configured provider (WEATHER_PROVIDER env) and runs its ingestion pass.
 * This is the only place server.js needs to call — it never has to know
 * which provider is active.
 */
async function runConfiguredWeatherIngestion({ imdStationIds = [], fetchFn, persistFn } = {}) {
  if (getActiveProvider() === 'imd') {
    return runWeatherIngestion(imdStationIds, { fetchFn, persistFn });
  }
  const locations = await getWeatherPollingLocations();
  return runWeatherApiIngestion(locations, { fetchFn, persistFn });
}

module.exports = {
  getWeatherForRoad,
  persistObservation,
  runWeatherIngestion,
  runWeatherApiIngestion,
  getWeatherPollingLocations,
  runConfiguredWeatherIngestion,
  getActiveProvider,
};
