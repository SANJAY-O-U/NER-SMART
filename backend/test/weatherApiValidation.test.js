const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWeatherApiCurrent } = require('../src/services/weatherApiValidation');

// Fixture: WeatherAPI.com `current.json` documented response shape
// (https://www.weatherapi.com/docs/#apis-realtime), trimmed to the
// fields this app actually maps.
const CURRENT_FIXTURE = {
  location: {
    name: 'Guwahati',
    region: 'Assam',
    country: 'India',
    lat: 26.14,
    lon: 91.73,
    tz_id: 'Asia/Kolkata',
    localtime: '2026-09-22 10:00',
  },
  current: {
    last_updated_epoch: 1758528600,
    last_updated: '2026-09-22 10:00',
    temp_c: 28.4,
    is_day: 1,
    condition: { text: 'Moderate rain', icon: '//cdn.weatherapi.com/x.png', code: 1189 },
    wind_kph: 12.0,
    wind_degree: 180,
    wind_dir: 'S',
    precip_mm: 42.6,
    humidity: 88,
    cloud: 90,
    feelslike_c: 30.1,
    vis_km: 6.0,
    uv: 4,
    gust_kph: 18.0,
  },
};

test('normalizeWeatherApiCurrent accepts a valid documented fixture', () => {
  const result = normalizeWeatherApiCurrent(CURRENT_FIXTURE, { lat: 26.1445, lng: 91.7362 });
  assert.equal(result.valid, true);
  assert.equal(result.normalized.source, 'WEATHERAPI_CURRENT');
  assert.equal(result.normalized.sourceRecordId, '26.1445,91.7362'); // identity = requested coords
  assert.deepEqual(result.normalized.location, { type: 'Point', coordinates: [91.73, 26.14] }); // point = resolved station coords
  assert.equal(result.normalized.observedAt.getTime(), 1758528600 * 1000);
});

test('normalizeWeatherApiCurrent maps rainfall from precip_mm', () => {
  const result = normalizeWeatherApiCurrent(CURRENT_FIXTURE, { lat: 26.14, lng: 91.73 });
  assert.equal(result.normalized.rainfallMm, 42.6);
});

test('normalizeWeatherApiCurrent maps wind speed and direction from wind_kph/wind_degree', () => {
  const result = normalizeWeatherApiCurrent(CURRENT_FIXTURE, { lat: 26.14, lng: 91.73 });
  assert.equal(result.normalized.windSpeedKmph, 12.0);
  assert.equal(result.normalized.windDirectionDeg, 180);
});

test('normalizeWeatherApiCurrent maps temperature and humidity', () => {
  const result = normalizeWeatherApiCurrent(CURRENT_FIXTURE, { lat: 26.14, lng: 91.73 });
  assert.equal(result.normalized.temperatureC, 28.4);
  assert.equal(result.normalized.humidityPct, 88);
});

test('normalizeWeatherApiCurrent maps weather condition text and never invents visibility/rainfallIntensity/warningLevel', () => {
  const result = normalizeWeatherApiCurrent(CURRENT_FIXTURE, { lat: 26.14, lng: 91.73 });
  assert.equal(result.normalized.weatherCondition, 'Moderate rain');
  // vis_km IS present in the fixture, but visibility is deliberately left
  // null — it is not part of this app's mapped field set (see
  // WEATHER_PROVIDER.md), same discipline as never fabricating a field.
  assert.equal(result.normalized.visibility, null);
  assert.equal(result.normalized.rainfallIntensity, null);
  assert.equal(result.normalized.warningLevel, null);
});

test('normalizeWeatherApiCurrent falls back to requested coordinates when location.lat/lon are absent', () => {
  const { location, ...rest } = CURRENT_FIXTURE;
  const result = normalizeWeatherApiCurrent(rest, { lat: 26.14, lng: 91.73 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.normalized.location, { type: 'Point', coordinates: [91.73, 26.14] });
});

test('normalizeWeatherApiCurrent rejects a response missing the current block', () => {
  const result = normalizeWeatherApiCurrent({ location: CURRENT_FIXTURE.location }, { lat: 26.14, lng: 91.73 });
  assert.equal(result.valid, false);
  assert.match(result.reason, /current/);
});

test('normalizeWeatherApiCurrent rejects when neither response nor caller supplies valid coordinates', () => {
  const { location, ...rest } = CURRENT_FIXTURE;
  const result = normalizeWeatherApiCurrent(rest, {});
  assert.equal(result.valid, false);
  assert.match(result.reason, /coordinates/);
});

test('normalizeWeatherApiCurrent handles a malformed (non-object) response without throwing', () => {
  assert.equal(normalizeWeatherApiCurrent(null).valid, false);
  assert.equal(normalizeWeatherApiCurrent('not json').valid, false);
  assert.equal(normalizeWeatherApiCurrent(undefined).valid, false);
});
