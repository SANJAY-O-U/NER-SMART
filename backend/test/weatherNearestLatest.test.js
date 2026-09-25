const test = require('node:test');
const assert = require('node:assert');
const WeatherObservation = require('../src/models/WeatherObservation');
const { findNearestWeather } = require('../src/services/weatherRoadService');

// Regression (Phase 7B): with observation history at the same point,
// $near returned an arbitrary (often oldest) row, so live weather was
// reported STALE. The lookup must return the location's newest reading.

function stubModel({ nearest, latest }) {
  const orig = { find: WeatherObservation.find, findOne: WeatherObservation.findOne };
  const calls = {};
  WeatherObservation.find = () => ({ limit: async () => (nearest ? [nearest] : []) });
  WeatherObservation.findOne = (filter) => {
    calls.findOne = filter;
    return { sort: async (s) => { calls.sort = s; return latest; } };
  };
  return { calls, restore: () => Object.assign(WeatherObservation, orig) };
}

const OLD = { source: 'WEATHERAPI_CURRENT', sourceRecordId: '24.4436,93.7267', observedAt: new Date('2026-09-22T14:30:00Z'), location: { coordinates: [93.767, 24.5] } };
const NEW = { ...OLD, observedAt: new Date('2026-09-25T05:45:00Z') };

test('returns the newest reading at the nearest location', async () => {
  const { calls, restore } = stubModel({ nearest: OLD, latest: NEW });
  try {
    const r = await findNearestWeather(24.5, 93.767);
    assert.strictEqual(r.observation, NEW);
    assert.deepStrictEqual(calls.findOne, { source: OLD.source, sourceRecordId: OLD.sourceRecordId });
    assert.deepStrictEqual(calls.sort, { observedAt: -1 });
    assert.strictEqual(r.distanceKm, 0);
  } finally { restore(); }
});

test('falls back to the $near row when it has no sourceRecordId', async () => {
  const legacy = { ...OLD, sourceRecordId: null };
  const { calls, restore } = stubModel({ nearest: legacy, latest: NEW });
  try {
    const r = await findNearestWeather(24.5, 93.767);
    assert.strictEqual(r.observation, legacy);
    assert.strictEqual(calls.findOne, undefined);
  } finally { restore(); }
});

test('returns null when nothing is within range', async () => {
  const { restore } = stubModel({ nearest: null, latest: null });
  try {
    assert.strictEqual(await findNearestWeather(24.5, 93.767), null);
  } finally { restore(); }
});
