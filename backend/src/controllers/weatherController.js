const Road = require('../models/Road');
const WeatherObservation = require('../models/WeatherObservation');
const { success, failure } = require('../utils/response');
const { findWeatherForRoad } = require('../services/weatherRoadService');
const { extractRiskFeaturesFromWeather } = require('../services/weatherRiskAdapter');
const { classifyFreshness } = require('../services/freshnessService');
const { getAwsWeather, hasCredentials } = require('../services/weatherService');
const { registerSource } = require('../services/dataSourceRegistry');
const { calculateRisk } = require('../services/riskService');

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
      reason: hasCredentials() ? 'no observation within range' : 'IMD credentials not configured — see IMD_INTEGRATION.md',
      riskInput,
      explanation,
    });
  }

  const observation = match.observation.toJSON ? match.observation.toJSON() : match.observation;
  const freshness = classifyFreshness({
    observedAt: observation.observedAt,
    receivedAt: observation.receivedAt,
    hasCredentials: hasCredentials(),
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

module.exports = { getWeatherForRoad, persistObservation, runWeatherIngestion };
