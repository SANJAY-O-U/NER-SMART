const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWeatherApiCurrent } = require('../src/services/weatherApiValidation');
const { extractRiskFeaturesFromWeather } = require('../src/services/weatherRiskAdapter');
const { buildWeatherEvidence, buildRoadStatusEvidence, buildDisasterEvidence } = require('../src/services/accessibilityEvidence');
const { computeAccessibilityFromEvidence } = require('../src/services/accessibilityEngine');
const { classifyFreshness } = require('../src/services/freshnessService');
const { computeDisasterRiskContribution } = require('../src/services/disasterRiskAdapter');

// Fixture: an extreme WeatherAPI current.json reading (heavy rain + severe
// gusts) — used to prove weather evidence can raise risk but can never by
// itself gate the accessibility state to BLOCKED/RESTRICTED.
const EXTREME_RAIN_FIXTURE = {
  location: { name: 'Imphal', region: 'Manipur', country: 'India', lat: 24.82, lon: 93.94 },
  current: {
    last_updated_epoch: Math.floor(Date.now() / 1000) - 300, // 5 minutes ago
    temp_c: 24.0,
    condition: { text: 'Torrential rain shower', code: 1246 },
    wind_kph: 95, // above the "very severe thunderstorm" gust threshold
    wind_degree: 200,
    precip_mm: 260, // extremely heavy rain, per IMD's own rainfall categories
    humidity: 97,
  },
};

function weatherApiMatch() {
  const { normalized } = normalizeWeatherApiCurrent(EXTREME_RAIN_FIXTURE, { lat: 24.817, lng: 93.9368 });
  return { observation: { ...normalized, sourceStatus: 'LIVE' }, distanceKm: 8.2, confidence: 'HIGH' };
}

// --- 11. WeatherAPI evidence reaching accessibility ---

test('a WeatherAPI-sourced observation reaches accessibility evidence with a real, explainable risk contribution', () => {
  const evidence = buildWeatherEvidence(weatherApiMatch(), extractRiskFeaturesFromWeather);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].type, 'RAINFALL_EXPOSURE');
  assert.ok(evidence[0].riskContribution > 0);
  assert.equal(evidence[0].status, null); // weather evidence never sets status directly
  assert.equal(evidence[0].source, 'WEATHERAPI_CURRENT'); // attributed to the real provider, never hardcoded to IMD_WEATHER
});

// --- 12. weather alone cannot produce BLOCKED ---

test('weather alone — even extreme WeatherAPI rainfall/wind — can raise risk but never BLOCKED or RESTRICTED', () => {
  const weatherEvidence = buildWeatherEvidence(weatherApiMatch(), extractRiskFeaturesFromWeather);
  const { state } = computeAccessibilityFromEvidence(weatherEvidence);
  assert.notEqual(state, 'BLOCKED');
  assert.notEqual(state, 'RESTRICTED');
  // Extreme rainfall crosses the HIGH_RISK score threshold — proving the
  // evidence genuinely contributes, it just never gates to BLOCKED/RESTRICTED.
  assert.equal(state, 'HIGH_RISK');
});

test('explicit BLOCKED road-status evidence still outranks extreme WeatherAPI weather evidence (priority cascade unchanged by the provider swap)', () => {
  const blockedRoadEvidence = buildRoadStatusEvidence({
    physicalStatus: 'BLOCKED',
    lastVerifiedAt: new Date(),
  });
  const weatherEvidence = buildWeatherEvidence(weatherApiMatch(), extractRiskFeaturesFromWeather);

  const { state } = computeAccessibilityFromEvidence([...blockedRoadEvidence, ...weatherEvidence]);
  assert.equal(state, 'BLOCKED');
});

// --- 8. cached observation fallback (freshness semantics unchanged by the provider swap) ---

test('a WeatherAPI reading 3 hours old classifies as CACHED, same freshness windows as any other provider', () => {
  const now = new Date('2026-09-22T12:00:00Z');
  const observedAt = new Date('2026-09-22T09:00:00Z'); // 3h old: beyond LIVE(90min), within CACHED(24h)
  const freshness = classifyFreshness({ observedAt, receivedAt: observedAt, now, hasCredentials: true });
  assert.equal(freshness, 'CACHED');
});

test('a fresh cached WeatherAPI row still reports UNAVAILABLE when the active provider currently has no credentials to attempt a new fetch', () => {
  const now = new Date('2026-09-22T12:00:00Z');
  const observedAt = new Date('2026-09-22T11:55:00Z'); // 5 minutes old
  const freshness = classifyFreshness({ observedAt, receivedAt: observedAt, now, hasCredentials: false });
  assert.equal(freshness, 'UNAVAILABLE');
});

// --- Failure mode F: SACHET disaster evidence + weather evidence together ---

test('a live NDMA SACHET alert combined with WeatherAPI weather evidence: disaster evidence still drives HIGH_RISK, weather evidence is not suppressed or overridden', () => {
  const now = new Date();
  const disasterEvidence = buildDisasterEvidence(
    [{ identifier: 'sachet-1', event: 'Flood', severity: 'Severe', urgency: 'Expected', certainty: 'Likely', lifecycleStatus: 'ACTIVE', associationConfidence: 'MEDIUM', associationMethod: 'LGD_DISTRICT_MATCH' }],
    computeDisasterRiskContribution,
    now
  );
  const weatherEvidence = buildWeatherEvidence(weatherApiMatch(), extractRiskFeaturesFromWeather, { now, classifyFreshness });

  const combined = computeAccessibilityFromEvidence([...disasterEvidence, ...weatherEvidence], { now });

  assert.equal(combined.state, 'HIGH_RISK');
  // Both independent sources must still be visible in the evidence trail —
  // weather evidence does not get dropped just because SACHET evidence exists.
  const sources = new Set(combined.evidence.map((e) => e.source));
  assert.ok(sources.has('NDMA_SACHET'));
  assert.ok(sources.has('WEATHERAPI_CURRENT'));
  // Two independent, agreeing, fresh sources -> at least MEDIUM confidence, never left UNKNOWN.
  assert.ok(['MEDIUM', 'HIGH'].includes(combined.confidence));
});
