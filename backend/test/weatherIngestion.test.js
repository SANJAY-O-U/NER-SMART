const test = require('node:test');
const assert = require('node:assert/strict');
const { runWeatherIngestion } = require('../src/controllers/weatherController');
const { getSource } = require('../src/services/dataSourceRegistry');
const { normalizeAwsData } = require('../src/services/weatherValidation');
const WeatherObservation = require('../src/models/WeatherObservation');

// Fixture: IMD AWS/ARG Data API (api-9) documented sample — same shape
// used in weatherValidation.test.js. This is the endpoint the ingestion
// job actually polls, because it's the only one of the three modeled
// endpoints that returns real station coordinates.
const AWS_FIXTURE = {
  ID: 'B48970CA',
  CALL_SIGN: 'GHY',
  DISTRICT: 'KAMRUP',
  STATE: 'ASSAM',
  STATION: 'GUWAHATI',
  DATE: '2026-09-15',
  TIME: '06:00:00',
  CURR_TEMP: '28.4',
  RH: '88',
  WIND_DIRECTION: '180',
  WIND_SPEED: '12',
  Latitude: '26.1445',
  Longitude: '91.7362',
  WEATHER_CODE: '63',
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

function abortError() {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

// --- Gating: no credentials / no stations — never touches network or DB ---

test('runWeatherIngestion returns UNAVAILABLE and never fetches when IMD_API_KEY is unset', async () => {
  await withEnv({ IMD_API_KEY: '' }, async () => {
    let fetchCalled = false;
    let persistCalled = false;
    const result = await runWeatherIngestion(['42314'], {
      fetchFn: async () => {
        fetchCalled = true;
        throw new Error('should not be called');
      },
      persistFn: async () => {
        persistCalled = true;
      },
    });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.persisted, 0);
    assert.equal(fetchCalled, false);
    assert.equal(persistCalled, false);
    assert.equal(getSource('IMD_WEATHER').status, 'UNAVAILABLE');
  });
});

test('runWeatherIngestion returns UNAVAILABLE and never fetches when no station IDs are configured', async () => {
  await withEnv({ IMD_API_KEY: 'test-key' }, async () => {
    let fetchCalled = false;
    const result = await runWeatherIngestion([], {
      fetchFn: async () => {
        fetchCalled = true;
        throw new Error('should not be called');
      },
    });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.errors[0], 'no_stations_configured');
    assert.equal(fetchCalled, false);
  });
});

// --- Successful authenticated response ---

test('runWeatherIngestion persists a normalized WeatherObservation on a successful authenticated fetch', async () => {
  await withEnv({ IMD_API_KEY: 'test-key' }, async () => {
    const persisted = [];
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => AWS_FIXTURE });
    const result = await runWeatherIngestion(['42314'], {
      fetchFn,
      persistFn: async (normalized) => persisted.push(normalized),
    });

    assert.equal(result.status, 'LIVE');
    assert.equal(result.persisted, 1);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].source, 'IMD_AWS');
    assert.equal(persisted[0].sourceRecordId, 'B48970CA');
    assert.equal(persisted[0].rainfallMm, null); // aws_data does not document a rainfall field
    assert.deepEqual(persisted[0].location.coordinates, [91.7362, 26.1445]);
    assert.equal(getSource('IMD_WEATHER').status, 'LIVE');
  });
});

// --- 401 / 403 ---

test('runWeatherIngestion does not persist on a 401 and reports UNAVAILABLE', async () => {
  await withEnv({ IMD_API_KEY: 'wrong-key' }, async () => {
    let persistCalled = false;
    const fetchFn = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const result = await runWeatherIngestion(['42314'], {
      fetchFn,
      persistFn: async () => {
        persistCalled = true;
      },
    });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.persisted, 0);
    assert.equal(persistCalled, false);
    assert.equal(result.errors[0].reason, 'HTTP 401');
  });
});

test('runWeatherIngestion does not persist on a 403 and reports UNAVAILABLE', async () => {
  await withEnv({ IMD_API_KEY: 'test-key' }, async () => {
    let persistCalled = false;
    const fetchFn = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const result = await runWeatherIngestion(['42314'], {
      fetchFn,
      persistFn: async () => {
        persistCalled = true;
      },
    });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.persisted, 0);
    assert.equal(persistCalled, false);
    assert.equal(result.errors[0].reason, 'HTTP 403');
  });
});

// --- timeout ---

test('runWeatherIngestion does not persist on a timeout and reports UNAVAILABLE', async () => {
  await withEnv({ IMD_API_KEY: 'test-key' }, async () => {
    let persistCalled = false;
    const fetchFn = async () => {
      throw abortError();
    };
    const result = await runWeatherIngestion(['42314'], {
      fetchFn,
      persistFn: async () => {
        persistCalled = true;
      },
    });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(persistCalled, false);
    assert.equal(result.errors[0].reason, 'timeout');
  });
});

// --- malformed response ---

test('runWeatherIngestion does not persist a malformed response (missing coordinates)', async () => {
  await withEnv({ IMD_API_KEY: 'test-key' }, async () => {
    let persistCalled = false;
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ ID: 'B48970CA' }) });
    const result = await runWeatherIngestion(['42314'], {
      fetchFn,
      persistFn: async () => {
        persistCalled = true;
      },
    });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(persistCalled, false);
    assert.match(result.errors[0].reason, /Latitude\/Longitude/);
  });
});

// --- partial success across multiple stations ---

test('runWeatherIngestion reports LIVE overall when some stations succeed and others fail', async () => {
  await withEnv({ IMD_API_KEY: 'test-key' }, async () => {
    const persisted = [];
    const fetchFn = async (url) => {
      if (String(url).includes('id=BAD')) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => AWS_FIXTURE };
    };
    const result = await runWeatherIngestion(['42314', 'BAD'], {
      fetchFn,
      persistFn: async (normalized) => persisted.push(normalized),
    });

    assert.equal(result.status, 'LIVE');
    assert.equal(result.persisted, 1);
    assert.equal(result.total, 2);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].stationId, 'BAD');
  });
});

// --- persisted shape is schema-valid (proves the write path is ready
// without opening a real MongoDB connection, same technique as
// incidentIdempotency.test.js's validateSync() checks) ---

test('a normalized AWS observation validates cleanly against the WeatherObservation schema, with sourceStatus set the way persistObservation sets it', () => {
  const { normalized } = normalizeAwsData(AWS_FIXTURE);
  const doc = new WeatherObservation({ ...normalized, sourceStatus: 'LIVE' });
  const err = doc.validateSync();
  assert.equal(err, undefined);
  assert.equal(doc.source, 'IMD_AWS');
  assert.equal(doc.rainfallMm, null);
});

// --- credentials never leak into results or registry ---

test('runWeatherIngestion never includes the API key in results or the data source registry', async () => {
  await withEnv({ IMD_API_KEY: 'super-secret-key-12345' }, async () => {
    const fetchFn = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const result = await runWeatherIngestion(['42314'], { fetchFn });
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /super-secret-key-12345/);
    const registryEntry = getSource('IMD_WEATHER');
    assert.doesNotMatch(JSON.stringify(registryEntry), /super-secret-key-12345/);
  });
});
