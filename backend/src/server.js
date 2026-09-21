require('dotenv').config();

const app = require('./app');
const connectDB = require('./config/db');
const Road = require('./models/Road');
const { registerSource } = require('./services/dataSourceRegistry');
const { hasCredentials } = require('./services/weatherService');
const { runWeatherIngestion } = require('./controllers/weatherController');
const { ingestSachetAlerts } = require('./services/sachetService');
const { persistAlert, expireOldAlerts } = require('./controllers/sachetController');

const PORT = process.env.PORT || 5000;

// Configurable, not hardcoded aggressive — per Phase 3B's scheduling
// requirement. Default 15 minutes is a reasonable balance between
// freshness and not hammering a free government feed with no rate-limit
// documentation. Set to 0 to disable automatic polling entirely (the
// /api/sachet/ingest endpoint can still be triggered manually/by a
// separate cron in that case).
const SACHET_POLL_INTERVAL_MINUTES = Number(process.env.SACHET_POLL_INTERVAL_MINUTES ?? 15);

// Phase 2: IMD weather ingestion. Defaults to 0 (disabled) — unlike
// SACHET, there are no verified NER station IDs yet (see
// IMD_INTEGRATION.md "Geographic limitations"), so auto-polling stays
// off until an operator explicitly sets both IMD_API_KEY and
// IMD_STATION_IDS to real, confirmed values. No station ID is invented
// here as a default.
const IMD_WEATHER_POLL_INTERVAL_MINUTES = Number(process.env.IMD_WEATHER_POLL_INTERVAL_MINUTES ?? 0);
const IMD_STATION_IDS = (process.env.IMD_STATION_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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

  // Phase 2: IMD weather. IMD_ACCESS = NOT_VERIFIED as of this writing —
  // see IMD_INTEGRATION.md. Registered honestly as UNAVAILABLE rather
  // than DEMO, because there is no substitute demo weather data either;
  // the dashboard should show exactly this state, not hide it.
  registerSource('IMD_WEATHER', {
    status: hasCredentials() ? 'CACHED' : 'UNAVAILABLE',
    source: 'IMD Current Weather / AWS APIs (api.imd.gov.in)',
    coverage: hasCredentials() ? 'Configured — awaiting first successful fetch' : 'Not available — no IMD_API_KEY configured',
    confidence: null,
    error: hasCredentials() ? null : 'No credentials. Registration requires an official .gov.in/.nic.in/.cdot.in/.cdac.in/.nhai.org/.icar.org.in email — see IMD_INTEGRATION.md',
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

/** One IMD weather ingestion pass: fetch configured stations, persist. */
async function runWeatherIngestionPass() {
  try {
    const result = await runWeatherIngestion(IMD_STATION_IDS);
    if (result.status === 'UNAVAILABLE') {
      console.warn('[IMD_WEATHER] ingestion unavailable:', result.errors);
      return;
    }
    console.log(`[IMD_WEATHER] ingestion pass complete: ${result.persisted}/${result.total} station(s) persisted`);
  } catch (err) {
    // Scheduled ingestion must never crash the server.
    console.error('[IMD_WEATHER] ingestion pass failed:', err.message);
  }
}

/** One ingestion pass: fetch, filter, parse, persist, expire. */
async function runSachetIngestion() {
  try {
    const result = await ingestSachetAlerts();
    if (result.status === 'UNAVAILABLE') {
      console.warn('[SACHET] ingestion unavailable:', result.errors);
      return;
    }
    if (result.unchanged) {
      await expireOldAlerts();
      return;
    }
    let persisted = 0;
    for (const alert of result.alerts) {
      try {
        await persistAlert(alert);
        persisted += 1;
      } catch (err) {
        console.warn('[SACHET] failed to persist alert', alert.identifier, err.message);
      }
    }
    await expireOldAlerts();
    console.log(`[SACHET] ingestion pass complete: ${persisted}/${result.totalCandidates} NER-relevant alerts persisted`);
  } catch (err) {
    // Scheduled ingestion must never crash the server.
    console.error('[SACHET] ingestion pass failed:', err.message);
  }
}

async function start() {
  await connectDB();
  await registerDataSources();

  if (SACHET_POLL_INTERVAL_MINUTES > 0) {
    // Run once shortly after startup, then on the configured interval.
    setTimeout(runSachetIngestion, 5000);
    setInterval(runSachetIngestion, SACHET_POLL_INTERVAL_MINUTES * 60 * 1000);
  }

  if (IMD_WEATHER_POLL_INTERVAL_MINUTES > 0 && hasCredentials() && IMD_STATION_IDS.length > 0) {
    setTimeout(runWeatherIngestionPass, 7000);
    setInterval(runWeatherIngestionPass, IMD_WEATHER_POLL_INTERVAL_MINUTES * 60 * 1000);
  }

  app.listen(PORT, () => {
    console.log(`NER-SMART backend running on http://localhost:${PORT} [APP_MODE=${process.env.APP_MODE || 'demo'}]`);
    if (SACHET_POLL_INTERVAL_MINUTES > 0) {
      console.log(`[SACHET] auto-polling every ${SACHET_POLL_INTERVAL_MINUTES} minutes`);
    }
    if (IMD_WEATHER_POLL_INTERVAL_MINUTES > 0 && hasCredentials() && IMD_STATION_IDS.length > 0) {
      console.log(`[IMD_WEATHER] auto-polling every ${IMD_WEATHER_POLL_INTERVAL_MINUTES} minutes`);
    }
  });
}

start();
