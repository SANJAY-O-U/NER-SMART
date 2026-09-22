const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRoadStatusEvidence,
  buildDisasterEvidence,
  buildWeatherEvidence,
  buildIncidentEvidence,
} = require('../src/services/accessibilityEvidence');

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
