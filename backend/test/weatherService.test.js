const test = require('node:test');
const assert = require('node:assert/strict');
const weatherService = require('../src/services/weatherService');

const CURRENT_WX_FIXTURE = {
  'Station Id': '42314',
  Station: 'GUWAHATI',
  'Date of Observation': '2026-09-15',
  'Time of Observation': '06:00',
  Temperature: '28.4',
  'Weather Code': '63',
  Humidity: '88',
  'Last 24 hrs Rainfall': '42.6',
  'Wind Speed': '12',
  'Wind Direction': '180',
};

function withEnv(vars, fn) {
  const original = {};
  for (const key of Object.keys(vars)) original[key] = process.env[key];
  Object.assign(process.env, vars);
  return fn().finally(() => {
    for (const key of Object.keys(vars)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
}

test('getCurrentWeather returns UNAVAILABLE with no_credentials when IMD_API_KEY is unset', async () => {
  await withEnv({ IMD_API_KEY: '' }, async () => {
    const result = await weatherService.getCurrentWeather('42314');
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.error, 'no_credentials');
    assert.equal(result.observation, null);
  });
});

test('getCurrentWeather never makes a network call when credentials are missing', async () => {
  await withEnv({ IMD_API_KEY: '' }, async () => {
    let called = false;
    const fetchFn = async () => {
      called = true;
      throw new Error('should not be called');
    };
    await weatherService.getCurrentWeather('42314', { fetchFn });
    assert.equal(called, false);
  });
});

test('getCurrentWeather normalizes a successful response into LIVE with an observation', async () => {
  await withEnv({ IMD_API_KEY: 'test-key' }, async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => CURRENT_WX_FIXTURE,
    });
    const result = await weatherService.getCurrentWeather('42314', { fetchFn, stationLat: 26.1, stationLng: 91.7 });
    assert.equal(result.status, 'LIVE');
    assert.equal(result.observation.sourceRecordId, '42314');
    assert.equal(result.observation.rainfallMm, 42.6);
  });
});

test('getCurrentWeather handles a 401 auth failure gracefully (does not throw, returns UNAVAILABLE)', async () => {
  await withEnv({ IMD_API_KEY: 'wrong-key' }, async () => {
    const fetchFn = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const result = await weatherService.getCurrentWeather('42314', { fetchFn });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.error, 'HTTP 401');
  });
});

test('getCurrentWeather does not retry on a 401 (not a transient failure)', async () => {
  await withEnv({ IMD_API_KEY: 'wrong-key' }, async () => {
    let callCount = 0;
    const fetchFn = async () => {
      callCount += 1;
      return { ok: false, status: 401, json: async () => ({}) };
    };
    await weatherService.getCurrentWeather('42314', { fetchFn });
    assert.equal(callCount, 1);
  });
});

test('getCurrentWeather handles a 403 forbidden response gracefully (does not throw, returns UNAVAILABLE)', async () => {
  await withEnv({ IMD_API_KEY: 'unauthorized-key' }, async () => {
    const fetchFn = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const result = await weatherService.getCurrentWeather('42314', { fetchFn });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.error, 'HTTP 403');
    assert.equal(result.observation, null);
  });
});

test('getCurrentWeather does not retry on a 403 (not a transient failure)', async () => {
  await withEnv({ IMD_API_KEY: 'unauthorized-key' }, async () => {
    let callCount = 0;
    const fetchFn = async () => {
      callCount += 1;
      return { ok: false, status: 403, json: async () => ({}) };
    };
    await weatherService.getCurrentWeather('42314', { fetchFn });
    assert.equal(callCount, 1);
  });
});

test('getCurrentWeather classifies an aborted request as a timeout, not a generic error', async () => {
  await withEnv({ IMD_API_KEY: 'test-key' }, async () => {
    const fetchFn = async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    };
    const result = await weatherService.getCurrentWeather('42314', { fetchFn });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.error, 'timeout');
  });
});

test('getCurrentWeather retries once on a transient 503, then succeeds', async () => {
  await withEnv({ IMD_API_KEY: 'test-key' }, async () => {
    let callCount = 0;
    const fetchFn = async () => {
      callCount += 1;
      if (callCount === 1) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => CURRENT_WX_FIXTURE };
    };
    const result = await weatherService.getCurrentWeather('42314', { fetchFn });
    assert.equal(callCount, 2);
    assert.equal(result.status, 'LIVE');
  });
});

test('getCurrentWeather handles a network error without throwing', async () => {
  await withEnv({ IMD_API_KEY: 'test-key' }, async () => {
    const fetchFn = async () => {
      throw new Error('ECONNRESET');
    };
    const result = await weatherService.getCurrentWeather('42314', { fetchFn });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.ok(result.error);
  });
});

test('getCurrentWeather rejects a malformed response body without crashing', async () => {
  await withEnv({ IMD_API_KEY: 'test-key' }, async () => {
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ unexpected: 'shape' }) });
    const result = await weatherService.getCurrentWeather('42314', { fetchFn });
    assert.equal(result.status, 'UNAVAILABLE');
  });
});
