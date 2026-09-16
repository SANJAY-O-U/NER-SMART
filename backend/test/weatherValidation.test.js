const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCurrentWx,
  normalizeAwsData,
  normalizeDistrictWarning,
  decodeWeatherCode,
} = require('../src/services/weatherValidation');

// Fixture: IMD Current Weather API (api-3) documented field shape.
const CURRENT_WX_FIXTURE = {
  'Station Id': '42314',
  Station: 'GUWAHATI',
  'Date of Observation': '2026-09-15',
  'Time of Observation': '06:00',
  'M.S.L.P': '1006.2',
  'Wind Direction': '180',
  'Wind Speed': '12',
  Temperature: '28.4',
  'Weather Code': '63',
  Nebulosity: '7',
  Humidity: '88',
  'Last 24 hrs Rainfall': '42.6',
};

// Fixture: IMD AWS/ARG Data API (api-9) documented sample.
const AWS_FIXTURE = {
  ID: 'B48970CA',
  CALL_SIGN: 'GHY',
  DISTRICT: 'KAMRUP',
  STATE: 'ASSAM',
  STATION: 'GUWAHATI',
  DATE: '2026-09-15',
  TIME: '06:00:00',
  CURR_TEMP: '28.4',
  DEW_POINT_TEMP: '24.1',
  RH: '88',
  WIND_DIRECTION: '180',
  WIND_SPEED: '12',
  MSLP: '1006.2',
  MIN_TEMP: '24.0',
  MAX_TEMP: '31.0',
  Latitude: '26.1445',
  Longitude: '91.7362',
  WEATHER_CODE: '63',
  NEBULOSITY: '7',
};

// Fixture: IMD District-wise Warnings API (api-6) documented shape.
const DISTRICT_WARNING_FIXTURE = {
  Obj_id: '164',
  Date: '2026-09-15',
  UTC: '00:00',
  District: 'KAMRUP',
  Day_1: '2',
  Day_2: '1',
  Day1_Color: '2',
};

test('normalizeCurrentWx accepts a valid documented fixture', () => {
  const result = normalizeCurrentWx(CURRENT_WX_FIXTURE, { stationLat: 26.1445, stationLng: 91.7362 });
  assert.equal(result.valid, true);
  assert.equal(result.normalized.source, 'IMD_CURRENT_WX');
  assert.equal(result.normalized.sourceRecordId, '42314');
  assert.equal(result.normalized.temperatureC, 28.4);
  assert.equal(result.normalized.rainfallMm, 42.6);
  assert.equal(result.normalized.weatherCondition, 'RAIN'); // code 63 -> rain range
  assert.deepEqual(result.normalized.location, { type: 'Point', coordinates: [91.7362, 26.1445] });
});

test('normalizeCurrentWx works without station coordinates (endpoint does not provide them)', () => {
  const result = normalizeCurrentWx(CURRENT_WX_FIXTURE);
  assert.equal(result.valid, true);
  assert.equal(result.normalized.location, null);
});

test('normalizeCurrentWx rejects a response missing Station Id', () => {
  const { 'Station Id': _drop, ...rest } = CURRENT_WX_FIXTURE;
  const result = normalizeCurrentWx(rest);
  assert.equal(result.valid, false);
  assert.match(result.reason, /Station Id/);
});

test('normalizeCurrentWx rejects invalid supplied coordinates', () => {
  const result = normalizeCurrentWx(CURRENT_WX_FIXTURE, { stationLat: 999, stationLng: 91.7 });
  assert.equal(result.valid, false);
});

test('normalizeCurrentWx handles a malformed (non-object) response without throwing', () => {
  assert.equal(normalizeCurrentWx(null).valid, false);
  assert.equal(normalizeCurrentWx('not json').valid, false);
  assert.equal(normalizeCurrentWx(undefined).valid, false);
});

test('normalizeAwsData accepts a valid documented fixture with real coordinates', () => {
  const result = normalizeAwsData(AWS_FIXTURE);
  assert.equal(result.valid, true);
  assert.equal(result.normalized.source, 'IMD_AWS');
  assert.equal(result.normalized.state, 'ASSAM');
  assert.equal(result.normalized.district, 'KAMRUP');
  assert.deepEqual(result.normalized.location, { type: 'Point', coordinates: [91.7362, 26.1445] });
});

test('normalizeAwsData rejects a response with missing coordinates', () => {
  const { Latitude, Longitude, ...rest } = AWS_FIXTURE;
  const result = normalizeAwsData(rest);
  assert.equal(result.valid, false);
  assert.match(result.reason, /Latitude/);
});

test('normalizeAwsData rejects out-of-range coordinates', () => {
  const result = normalizeAwsData({ ...AWS_FIXTURE, Latitude: '999', Longitude: '91.7' });
  assert.equal(result.valid, false);
});

test('normalizeDistrictWarning decodes a single warning code', () => {
  const result = normalizeDistrictWarning(DISTRICT_WARNING_FIXTURE);
  assert.equal(result.valid, true);
  assert.equal(result.normalized.warningLevel, 'HEAVY_RAIN');
  assert.equal(result.normalized.district, 'KAMRUP');
});

test('normalizeDistrictWarning decodes multiple comma-separated codes', () => {
  const result = normalizeDistrictWarning({ ...DISTRICT_WARNING_FIXTURE, Day_1: '2,4' });
  assert.equal(result.valid, true);
  assert.equal(result.normalized.warningLevel, 'HEAVY_RAIN, THUNDERSTORM_LIGHTNING');
});

test('normalizeDistrictWarning rejects missing District', () => {
  const { District, ...rest } = DISTRICT_WARNING_FIXTURE;
  const result = normalizeDistrictWarning(rest);
  assert.equal(result.valid, false);
});

test('decodeWeatherCode maps documented ranges correctly', () => {
  assert.equal(decodeWeatherCode(63), 'RAIN');
  assert.equal(decodeWeatherCode(81), 'RAIN_SHOWERS');
  assert.equal(decodeWeatherCode(95), 'THUNDERSTORM');
  assert.equal(decodeWeatherCode(45), 'FOG');
  assert.equal(decodeWeatherCode(1), 'CLEAR_OR_STABLE');
});

test('decodeWeatherCode returns null for non-numeric input rather than guessing', () => {
  assert.equal(decodeWeatherCode('not-a-code'), null);
  assert.equal(decodeWeatherCode(undefined), null);
});
