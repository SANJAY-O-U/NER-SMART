require('dotenv').config();

// Phase 7A: in NODE_ENV=production, abort startup (naming variables, never
// values) if any mandatory configuration is missing — before connecting
// to MongoDB or starting any scheduler.
require('./config/productionEnv').assertProductionEnv();

const app = require('./app');
const connectDB = require('./config/db');
const Road = require('./models/Road');
const { registerSource } = require('./services/dataSourceRegistry');
const { hasCredentials } = require('./services/weatherService');
const weatherApiService = require('./services/weatherApiService');
const { runConfiguredWeatherIngestion, getActiveProvider } = require('./controllers/weatherController');
const { runScheduledSachetPass } = require('./controllers/sachetController');

const PORT = process.env.PORT || 5000;

// Configurable, not hardcoded aggressive — per Phase 3B's scheduling
// requirement. Default 15 minutes is a reasonable balance between
// freshness and not hammering a free government feed with no rate-limit
// documentation. Set to 0 to disable automatic polling entirely (the
// /api/sachet/ingest endpoint can still be triggered manually/by a
// separate cron in that case).
const SACHET_POLL_INTERVAL_MINUTES = Number(process.env.SACHET_POLL_INTERVAL_MINUTES ?? 15);

const WEATHER_PROVIDER = getActiveProvider();

// Weather polling interval. Applies to whichever provider is active (see
// WEATHER_PROVIDER.md) — WeatherAPI.com by default. 0 disables automatic
// polling entirely (the ingestion pass can still be triggered manually).
const WEATHER_POLL_INTERVAL_MINUTES = Number(process.env.WEATHER_POLL_INTERVAL_MINUTES ?? 15);

// IMD weather ingestion interval. Kept fully separate from the line
// above because IMD is a FUTURE provider (IMD_ACCESS = NOT_VERIFIED —
// see IMD_INTEGRATION.md): there are no verified NER station IDs yet, so
// this stays 0 (disabled) unless an operator explicitly sets both
// IMD_API_KEY and IMD_STATION_IDS to real, confirmed values AND flips
// WEATHER_PROVIDER=imd. No station ID is invented here as a default.
const IMD_WEATHER_POLL_INTERVAL_MINUTES = Number(process.env.IMD_WEATHER_POLL_INTERVAL_MINUTES ?? 0);
const IMD_STATION_IDS = (process.env.IMD_STATION_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// The single scheduler picks whichever provider is configured and uses
// THAT provider's own interval/readiness — see runWeatherIngestionPass.
const ACTIVE_WEATHER_POLL_INTERVAL_MINUTES =
  WEATHER_PROVIDER === 'imd' ? IMD_WEATHER_POLL_INTERVAL_MINUTES : WEATHER_POLL_INTERVAL_MINUTES;

function activeWeatherProviderReady() {
  if (WEATHER_PROVIDER === 'imd') {
    return hasCredentials() && IMD_STATION_IDS.length > 0;
  }
  return weatherApiService.hasCredentials();
}

/**
 * Populates the data source registry foundation at startup. Currently
 * registers road network (Phase 1), weather (Phase 2), and SACHET
 * (Phase 3B, initial UNAVAILABLE state until the first poll completes).
 */
async function registerDataSources() {
  const realRoadCount = await Road.countDocuments({ geometry: { $exists: true } });

  registerSource('NER_ROAD_NETWORK', {
    status: realRoadCount > 0 ? 'CACHED' : 'DEMO',
    source: realRoadCount > 0
      ? 'datta07/INDIAN-SHAPEFILES (MIT) — community-compiled, not an official government feed'
      : 'Prototype demo road points (screening-demo seed data)',
    coverage: realRoadCount > 0 ? 'Guwahati-Imphal corridor (NH 27 / NH 29 / NH 2)' : 'None (demo only)',
    confidence: realRoadCount > 0 ? 0.8 : null,
  });

  // IMD weather — kept as a FUTURE provider (IMD_ACCESS = NOT_VERIFIED as
  // of this writing — see IMD_INTEGRATION.md). Registered honestly as
  // UNAVAILABLE rather than DEMO, because there is no substitute demo
  // weather data either; the dashboard should show exactly this state,
  // not hide it. Visible regardless of which provider is active.
  registerSource('IMD_WEATHER', {
    status: hasCredentials() ? 'CACHED' : 'UNAVAILABLE',
    source: 'IMD Current Weather / AWS APIs (api.imd.gov.in)',
    coverage: hasCredentials() ? 'Configured — awaiting first successful fetch' : 'Not available — no IMD_API_KEY configured',
    confidence: null,
    error: hasCredentials() ? null : 'No credentials. Registration requires an official .gov.in/.nic.in/.cdot.in/.cdac.in/.nhai.org/.icar.org.in email — see IMD_INTEGRATION.md',
  });

  // WeatherAPI.com — the ACTIVE provider by default (see
  // WEATHER_PROVIDER.md). Registered honestly as UNAVAILABLE until the
  // first real fetch succeeds; an API key being present does not by
  // itself mean LIVE/CONNECTED/VERIFIED.
  registerSource('WEATHERAPI_WEATHER', {
    status: 'UNAVAILABLE',
    source: 'WeatherAPI.com Current Weather API (third-party, not an official government feed)',
    coverage: weatherApiService.hasCredentials() ? 'Configured — awaiting first successful fetch' : 'Not available — no WEATHERAPI_API_KEY configured',
    confidence: null,
    error: weatherApiService.hasCredentials() ? 'Awaiting first ingestion pass' : 'No credentials. Set WEATHERAPI_API_KEY in backend/.env — see WEATHER_PROVIDER.md',
  });

  // Phase 3B: NDMA SACHET. Verified live and credential-free in Phase
  // 3A. Registered as UNAVAILABLE until the first ingestion pass
  // completes (below) — never claim LIVE before a real fetch succeeds.
  registerSource('NDMA_SACHET', {
    status: 'UNAVAILABLE',
    source: 'NDMA SACHET National RSS Feed + CAP 1.2 detail (sachet.ndma.gov.in)',
    coverage: 'India, filtered to 8 NER states',
    confidence: null,
    error: 'Awaiting first ingestion pass',
  });
}

/**
 * One weather ingestion pass, via the single configured-provider
 * scheduler (see WEATHER_PROVIDER.md / runConfiguredWeatherIngestion).
 * Never crashes the server, and never claims success without a real
 * persisted observation.
 */
async function runWeatherIngestionPass() {
  const tag = WEATHER_PROVIDER === 'imd' ? 'IMD_WEATHER' : 'WEATHERAPI_WEATHER';
  try {
    const result = await runConfiguredWeatherIngestion({ imdStationIds: IMD_STATION_IDS });
    if (result.status === 'UNAVAILABLE') {
      console.warn(`[${tag}] ingestion unavailable:`, result.errors);
      return;
    }
    console.log(`[${tag}] ingestion pass complete: ${result.persisted}/${result.total} location(s) persisted`);
  } catch (err) {
    // Scheduled ingestion must never crash the server.
    console.error(`[${tag}] ingestion pass failed:`, err.message);
  }
}

/**
 * One ingestion pass: fetch, filter, parse, persist — then expire stored
 * alerts regardless of whether the fetch succeeded (Phase 8B.1, see
 * sachetController.runScheduledSachetPass).
 */
async function runSachetIngestion() {
  await runScheduledSachetPass();
}

async function start() {
  await connectDB();
  await registerDataSources();

  if (SACHET_POLL_INTERVAL_MINUTES > 0) {
    // Run once shortly after startup, then on the configured interval.
    setTimeout(runSachetIngestion, 5000);
    setInterval(runSachetIngestion, SACHET_POLL_INTERVAL_MINUTES * 60 * 1000);
  }

  // The single weather scheduler: one interval, chosen by whichever
  // provider WEATHER_PROVIDER selects (see runConfiguredWeatherIngestion).
  if (ACTIVE_WEATHER_POLL_INTERVAL_MINUTES > 0 && activeWeatherProviderReady()) {
    setTimeout(runWeatherIngestionPass, 7000);
    setInterval(runWeatherIngestionPass, ACTIVE_WEATHER_POLL_INTERVAL_MINUTES * 60 * 1000);
  }

  app.listen(PORT, () => {
    console.log(`NER-SMART backend running on http://localhost:${PORT} [APP_MODE=${process.env.APP_MODE || 'unset'}]`);
    console.log(`[WEATHER] active provider: ${WEATHER_PROVIDER}`);
    if (SACHET_POLL_INTERVAL_MINUTES > 0) {
      console.log(`[SACHET] auto-polling every ${SACHET_POLL_INTERVAL_MINUTES} minutes`);
    }
    if (ACTIVE_WEATHER_POLL_INTERVAL_MINUTES > 0 && activeWeatherProviderReady()) {
      console.log(`[${WEATHER_PROVIDER.toUpperCase()}_WEATHER] auto-polling every ${ACTIVE_WEATHER_POLL_INTERVAL_MINUTES} minutes`);
    }
  });
}

start();
