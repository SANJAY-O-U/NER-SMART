const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRoadStatusEvidence,
  buildDisasterEvidence,
  buildWeatherEvidence,
  buildIncidentEvidence,
} = require('../src/services/accessibilityEvidence');
const { classifyFreshness } = require('../src/services/freshnessService');
const { computeAccessibilityFromEvidence } = require('../src/services/accessibilityEngine');

test('buildRoadStatusEvidence skips UNKNOWN/absent statuses entirely', () => {
  const road = { physicalStatus: 'UNKNOWN', officialStatus: 'UNKNOWN', fieldStatus: 'UNKNOWN' };
  assert.deepEqual(buildRoadStatusEvidence(road), []);
});

test('buildRoadStatusEvidence produces one item per set status', () => {
  const road = { physicalStatus: 'OPEN', officialStatus: 'UNKNOWN', fieldStatus: 'RESTRICTED', lastVerifiedAt: new Date() };
  const items = buildRoadStatusEvidence(road);
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.source === 'ROAD_STATUS'));
});

test('buildRoadStatusEvidence handles a null road without throwing', () => {
  assert.deepEqual(buildRoadStatusEvidence(null), []);
});

test('buildDisasterEvidence drops alerts that score 0 (expired)', () => {
  const computeFn = () => ({ score: 0 });
  const items = buildDisasterEvidence([{ identifier: 'a' }], computeFn, new Date());
  assert.deepEqual(items, []);
});

test('buildDisasterEvidence includes alerts with a nonzero live score', () => {
  const computeFn = () => ({ score: 65 });
  const items = buildDisasterEvidence(
    [{ identifier: 'a', event: 'Flood', severity: 'Severe', lifecycleStatus: 'ACTIVE', associationConfidence: 'MEDIUM', associationMethod: 'LGD_DISTRICT_MATCH' }],
    computeFn,
    new Date()
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'NDMA_SACHET');
  assert.equal(items[0].riskContribution, 65);
  assert.equal(items[0].freshness, 'LIVE');
});

test('buildDisasterEvidence marks non-ACTIVE alerts as STALE freshness', () => {
  const computeFn = () => ({ score: 40 });
  const items = buildDisasterEvidence([{ identifier: 'a', lifecycleStatus: 'EXPIRED' }], computeFn, new Date());
  assert.equal(items[0].freshness, 'STALE');
});

test('buildDisasterEvidence handles an empty alert list', () => {
  assert.deepEqual(buildDisasterEvidence([], () => ({ score: 0 })), []);
});

test('buildWeatherEvidence returns empty when weatherMatch is null (IMD unavailable)', () => {
  assert.deepEqual(buildWeatherEvidence(null, () => ({ explanation: [] })), []);
});

test('buildWeatherEvidence returns empty when the risk adapter has no rainfall factor', () => {
  const extractFn = () => ({ explanation: [] });
  assert.deepEqual(buildWeatherEvidence({ observation: {} }, extractFn), []);
});

test('buildWeatherEvidence produces one item when rainfall contribution exists, with source taken from the observation itself (not hardcoded)', () => {
  const extractFn = () => ({ explanation: [{ factor: 'rainfall', contribution: 30 }] });
  const items = buildWeatherEvidence(
    { observation: { source: 'IMD_AWS', observedAt: new Date(), sourceStatus: 'LIVE' }, distanceKm: 12, confidence: 'MEDIUM' },
    extractFn
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'IMD_AWS'); // derived from weather.source, not a hardcoded literal
  assert.equal(items[0].riskContribution, 30);
});

test('buildWeatherEvidence reports source: WEATHERAPI_CURRENT when the underlying observation came from WeatherAPI', () => {
  const extractFn = () => ({ explanation: [{ factor: 'rainfall', contribution: 45 }] });
  const items = buildWeatherEvidence(
    { observation: { source: 'WEATHERAPI_CURRENT', observedAt: new Date(), sourceStatus: 'LIVE' }, distanceKm: 4.2, confidence: 'HIGH' },
    extractFn
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'WEATHERAPI_CURRENT');
  assert.doesNotMatch(items[0].detail, /IMD/); // provider-neutral wording, never claims IMD for non-IMD data
});

// --- Phase 3: weather freshness must come from the observation's real age,
// never from the stored sourceStatus flag (which only records "the fetch
// that wrote this row succeeded" and is frozen to 'LIVE' forever — see
// weatherController.js's persistObservation) ---

test('buildWeatherEvidence classifies a fresh WeatherAPI observation as LIVE via the injected classifyFreshness', () => {
  const extractFn = () => ({ explanation: [{ factor: 'rainfall', contribution: 40 }] });
  const now = new Date('2026-09-23T12:00:00Z');
  const items = buildWeatherEvidence(
    {
      observation: {
        source: 'WEATHERAPI_CURRENT',
        observedAt: new Date('2026-09-23T11:50:00Z'), // 10 minutes old
        receivedAt: new Date('2026-09-23T11:50:05Z'),
        sourceStatus: 'LIVE',
      },
      distanceKm: 3,
      confidence: 'HIGH',
    },
    extractFn,
    { now, classifyFreshness }
  );
  assert.equal(items[0].freshness, 'LIVE');
});

test('buildWeatherEvidence classifies a stale WeatherAPI observation as STALE even though sourceStatus is still LIVE', () => {
  const extractFn = () => ({ explanation: [{ factor: 'rainfall', contribution: 40 }] });
  const now = new Date('2026-09-23T12:00:00Z');
  const items = buildWeatherEvidence(
    {
      observation: {
        source: 'WEATHERAPI_CURRENT',
        observedAt: new Date('2026-09-20T12:00:00Z'), // 3 days old
        receivedAt: new Date('2026-09-20T12:00:05Z'),
        sourceStatus: 'LIVE', // frozen at persist time — must NOT be trusted for freshness
      },
      distanceKm: 3,
      confidence: 'HIGH',
    },
    extractFn,
    { now, classifyFreshness }
  );
  assert.equal(items[0].freshness, 'STALE');
});

test('buildWeatherEvidence falls back to the old sourceStatus-derived freshness when classifyFreshness is not injected (backward compatible)', () => {
  const extractFn = () => ({ explanation: [{ factor: 'rainfall', contribution: 40 }] });
  const items = buildWeatherEvidence(
    { observation: { source: 'WEATHERAPI_CURRENT', observedAt: new Date('2020-01-01'), sourceStatus: 'CACHED' }, distanceKm: 3 },
    extractFn
  );
  assert.equal(items[0].freshness, 'CACHED');
});

test('a STALE weather observation cannot masquerade as fresh evidence in the accessibility engine: extreme rainfall 3 days old does not drive state to HIGH_RISK', () => {
  const extractFn = () => ({ explanation: [{ factor: 'rainfall', contribution: 95 }] }); // would be HIGH_RISK if trusted as fresh
  const now = new Date('2026-09-23T12:00:00Z');
  const staleEvidence = buildWeatherEvidence(
    {
      observation: {
        source: 'WEATHERAPI_CURRENT',
        observedAt: new Date('2026-09-20T12:00:00Z'), // 3 days old -> STALE
        receivedAt: new Date('2026-09-20T12:00:05Z'),
        sourceStatus: 'LIVE',
      },
      distanceKm: 3,
      confidence: 'HIGH',
    },
    extractFn,
    { now, classifyFreshness }
  );
  const { state } = computeAccessibilityFromEvidence(staleEvidence, { now });
  assert.equal(state, 'UNKNOWN'); // stale evidence is excluded from the active-evidence cascade entirely
});

test('a missing observedAt/receivedAt on a weather observation classifies as UNAVAILABLE, never fabricated as fresh', () => {
  const extractFn = () => ({ explanation: [{ factor: 'rainfall', contribution: 40 }] });
  const now = new Date('2026-09-23T12:00:00Z');
  const items = buildWeatherEvidence(
    { observation: { source: 'WEATHERAPI_CURRENT', observedAt: null, receivedAt: null, sourceStatus: 'LIVE' }, distanceKm: 3 },
    extractFn,
    { now, classifyFreshness }
  );
  assert.equal(items[0].freshness, 'UNAVAILABLE');
});

test('buildIncidentEvidence excludes RESOLVED incidents', () => {
  const items = buildIncidentEvidence([{ status: 'RESOLVED', severity: 'HIGH', type: 'FLOOD' }]);
  assert.deepEqual(items, []);
});

test('buildIncidentEvidence includes active incidents with severity-based risk', () => {
  const items = buildIncidentEvidence([{ status: 'AI_ANALYSED', severity: 'HIGH', type: 'LANDSLIDE', roadMatchConfidence: 'HIGH' }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].riskContribution, 75);
  assert.equal(items[0].confidence, 'HIGH');
});

test('buildIncidentEvidence caps confidence at LOW when road-match confidence is LOW', () => {
  const items = buildIncidentEvidence([{ status: 'REPORTED', severity: 'HIGH', type: 'FLOOD', roadMatchConfidence: 'LOW' }]);
  assert.equal(items[0].confidence, 'LOW');
});

test('buildIncidentEvidence handles an empty list', () => {
  assert.deepEqual(buildIncidentEvidence([]), []);
});
