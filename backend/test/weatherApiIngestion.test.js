const test = require('node:test');
const assert = require('node:assert/strict');
const {
  runWeatherApiIngestion,
  runConfiguredWeatherIngestion,
  getActiveProvider,
} = require('../src/controllers/weatherController');
const { getSource } = require('../src/services/dataSourceRegistry');
const { normalizeWeatherApiCurrent } = require('../src/services/weatherApiValidation');
const WeatherObservation = require('../src/models/WeatherObservation');

const GUWAHATI = { lat: 26.1445, lng: 91.7362, label: 'NH27 Guwahati bypass' };

// Fixture: WeatherAPI.com current.json documented sample.
const CURRENT_FIXTURE = {
  location: { name: 'Guwahati', region: 'Assam', country: 'India', lat: 26.14, lon: 91.73 },
  current: {
    last_updated_epoch: 1758528600,
    temp_c: 28.4,
    condition: { text: 'Moderate rain', code: 1189 },
    wind_kph: 12.0,
    wind_degree: 180,
    precip_mm: 42.6,
    humidity: 88,
  },
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

// --- Gating: no credentials / no locations — never touches network or DB ---

test('runWeatherApiIngestion returns UNAVAILABLE and never fetches when WEATHERAPI_API_KEY is unset', async () => {
  await withEnv({ WEATHERAPI_API_KEY: '' }, async () => {
    let fetchCalled = false;
    let persistCalled = false;
    const result = await runWeatherApiIngestion([GUWAHATI], {
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
    assert.equal(getSource('WEATHERAPI_WEATHER').status, 'UNAVAILABLE');
  });
});

test('runWeatherApiIngestion returns UNAVAILABLE and never fetches when no locations are configured', async () => {
  await withEnv({ WEATHERAPI_API_KEY: 'test-key' }, async () => {
    let fetchCalled = false;
    const result = await runWeatherApiIngestion([], {
      fetchFn: async () => {
        fetchCalled = true;
        throw new Error('should not be called');
      },
    });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.errors[0], 'no_locations_configured');
    assert.equal(fetchCalled, false);
  });
});

// --- Successful authenticated response ---

test('runWeatherApiIngestion persists a normalized WeatherObservation on a successful authenticated fetch', async () => {
  await withEnv({ WEATHERAPI_API_KEY: 'test-key' }, async () => {
    const persisted = [];
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => CURRENT_FIXTURE });
    const result = await runWeatherApiIngestion([GUWAHATI], {
      fetchFn,
      persistFn: async (normalized) => persisted.push(normalized),
    });

    assert.equal(result.status, 'LIVE');
    assert.equal(result.persisted, 1);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].source, 'WEATHERAPI_CURRENT');
    assert.equal(persisted[0].sourceRecordId, '26.1445,91.7362');
    assert.equal(persisted[0].rainfallMm, 42.6);
    assert.equal(getSource('WEATHERAPI_WEATHER').status, 'LIVE');
  });
});

// --- 401 / 403 ---

test('runWeatherApiIngestion does not persist on a 401 and reports UNAVAILABLE', async () => {
  await withEnv({ WEATHERAPI_API_KEY: 'wrong-key' }, async () => {
    let persistCalled = false;
    const fetchFn = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const result = await runWeatherApiIngestion([GUWAHATI], {
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

test('runWeatherApiIngestion does not persist on a 403 and reports UNAVAILABLE', async () => {
  await withEnv({ WEATHERAPI_API_KEY: 'test-key' }, async () => {
    let persistCalled = false;
    const fetchFn = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const result = await runWeatherApiIngestion([GUWAHATI], {
      fetchFn,
      persistFn: async () => {
        persistCalled = true;
      },
    });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(persistCalled, false);
    assert.equal(result.errors[0].reason, 'HTTP 403');
  });
});

// --- timeout ---

test('runWeatherApiIngestion does not persist on a timeout and reports UNAVAILABLE', async () => {
  await withEnv({ WEATHERAPI_API_KEY: 'test-key' }, async () => {
    let persistCalled = false;
    const fetchFn = async () => {
      throw abortError();
    };
    const result = await runWeatherApiIngestion([GUWAHATI], {
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

test('runWeatherApiIngestion does not persist a malformed response (missing current block)', async () => {
  await withEnv({ WEATHERAPI_API_KEY: 'test-key' }, async () => {
    let persistCalled = false;
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ location: CURRENT_FIXTURE.location }) });
    const result = await runWeatherApiIngestion([GUWAHATI], {
      fetchFn,
      persistFn: async () => {
        persistCalled = true;
      },
    });
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(persistCalled, false);
    assert.match(result.errors[0].reason, /current/);
  });
});

// --- partial success across multiple locations ---

test('runWeatherApiIngestion reports LIVE overall when some locations succeed and others fail', async () => {
  await withEnv({ WEATHERAPI_API_KEY: 'test-key' }, async () => {
    const persisted = [];
    const BAD = { lat: 0, lng: 0, label: 'unreachable' };
    const fetchFn = async (url) => {
      if (String(url).includes('q=0%2C0')) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => CURRENT_FIXTURE };
    };
    const result = await runWeatherApiIngestion([GUWAHATI, BAD], {
      fetchFn,
      persistFn: async (normalized) => persisted.push(normalized),
    });

    assert.equal(result.status, 'LIVE');
    assert.equal(result.persisted, 1);
    assert.equal(result.total, 2);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].location, 'unreachable');
  });
});

// --- persisted shape is schema-valid, no live MongoDB connection needed ---

test('a normalized WeatherAPI observation validates cleanly against the WeatherObservation schema', () => {
  const { normalized } = normalizeWeatherApiCurrent(CURRENT_FIXTURE, { lat: 26.1445, lng: 91.7362 });
  const doc = new WeatherObservation({ ...normalized, sourceStatus: 'LIVE' });
  const err = doc.validateSync();
  assert.equal(err, undefined);
  assert.equal(doc.source, 'WEATHERAPI_CURRENT');
  assert.equal(doc.rainfallMm, 42.6);
});

// --- provider selection ---

test('runConfiguredWeatherIngestion routes to the IMD path (and registers IMD_WEATHER, not WEATHERAPI_WEATHER) when WEATHER_PROVIDER=imd', async () => {
  await withEnv({ WEATHER_PROVIDER: 'imd', IMD_API_KEY: 'test-key', WEATHERAPI_API_KEY: '' }, async () => {
    assert.equal(getActiveProvider(), 'imd');
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ID: 'B48970CA',
        Latitude: '26.1445',
        Longitude: '91.7362',
        CURR_TEMP: '28.4',
        RH: '88',
        WIND_SPEED: '12',
        WIND_DIRECTION: '180',
        WEATHER_CODE: '63',
      }),
    });
    const persisted = [];
    const result = await runConfiguredWeatherIngestion({
      imdStationIds: ['42314'],
      fetchFn,
      persistFn: async (normalized) => persisted.push(normalized),
    });
    assert.equal(result.status, 'LIVE');
    assert.equal(result.total, 1);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].source, 'IMD_AWS'); // proves the IMD path ran, not WeatherAPI's
    assert.ok(getSource('IMD_WEATHER'));
  });
});

test('runConfiguredWeatherIngestion defaults to weatherapi when WEATHER_PROVIDER is unset', async () => {
  await withEnv({ WEATHER_PROVIDER: '' }, async () => {
    assert.equal(getActiveProvider(), 'weatherapi');
  });
});

// --- credentials never leak into results or registry ---

test('runWeatherApiIngestion never includes the API key in results or the data source registry', async () => {
  await withEnv({ WEATHERAPI_API_KEY: 'super-secret-key-12345' }, async () => {
    const fetchFn = async () => ({ ok: false, status: 401, json: async () => ({}) });
    const result = await runWeatherApiIngestion([GUWAHATI], { fetchFn });
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /super-secret-key-12345/);
    const registryEntry = getSource('WEATHERAPI_WEATHER');
    assert.doesNotMatch(JSON.stringify(registryEntry), /super-secret-key-12345/);
  });
});
