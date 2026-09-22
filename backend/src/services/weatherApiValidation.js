/**
 * Pure functions that validate and normalize WeatherAPI.com's
 * `current.json` response into the SAME WeatherObservation shape used by
 * `weatherValidation.js` (IMD). No network calls, no DB — unit-testable
 * against fixtures built from WeatherAPI's documented response format
 * (https://www.weatherapi.com/docs/, current.json).
 *
 * See WEATHER_PROVIDER.md for which fields are mapped and why the rest
 * (visibility, rainfall intensity, warning level) stay `null` — never
 * fabricated, exactly like IMD's normalizers.
 */

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isValidLatLng(lat, lng) {
  return isFiniteNumber(lat) && isFiniteNumber(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * @param {object} raw - the parsed `current.json` response body
 * @param {object} [requested] - the coordinates the request was made
 *   with (`{ lat, lng }`), used both as a fallback when the response
 *   omits `location.lat/lon` and as the stable identity for
 *   `sourceRecordId` (so the same polled location upserts consistently
 *   even if WeatherAPI snaps to a slightly different nearest station
 *   between calls).
 */
function normalizeWeatherApiCurrent(raw, { lat = null, lng = null } = {}) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'response is not an object' };
  }

  const current = raw.current;
  if (!current || typeof current !== 'object') {
    return { valid: false, reason: 'missing current block' };
  }

  const loc = raw.location && typeof raw.location === 'object' ? raw.location : {};
  const requestedLat = toNumberOrNull(lat);
  const requestedLng = toNumberOrNull(lng);
  const stationLat = toNumberOrNull(loc.lat);
  const stationLng = toNumberOrNull(loc.lon);

  // Identity (for sourceRecordId) prefers the coordinates we polled with;
  // the point we actually store prefers WeatherAPI's resolved station
  // location (more accurate to where the reading was taken), falling
  // back to the requested coordinates when the response omits it.
  const identityLat = requestedLat !== null ? requestedLat : stationLat;
  const identityLng = requestedLng !== null ? requestedLng : stationLng;
  if (!isValidLatLng(identityLat, identityLng)) {
    return { valid: false, reason: 'missing or invalid location coordinates' };
  }
  const pointLat = stationLat !== null ? stationLat : identityLat;
  const pointLng = stationLng !== null ? stationLng : identityLng;

  let observedAt = null;
  const epoch = toNumberOrNull(current.last_updated_epoch);
  if (epoch !== null) {
    const parsed = new Date(epoch * 1000);
    if (!Number.isNaN(parsed.getTime())) observedAt = parsed;
  }

  const normalized = {
    source: 'WEATHERAPI_CURRENT',
    sourceRecordId: `${identityLat.toFixed(4)},${identityLng.toFixed(4)}`,
    stationName: loc.name || null,
    observedAt,
    location: { type: 'Point', coordinates: [pointLng, pointLat] },
    state: null, // not part of the mapped field set — see WEATHER_PROVIDER.md
    district: null, // WeatherAPI does not provide Indian LGD-style district data
    temperatureC: toNumberOrNull(current.temp_c),
    humidityPct: toNumberOrNull(current.humidity),
    rainfallMm: toNumberOrNull(current.precip_mm),
    windSpeedKmph: toNumberOrNull(current.wind_kph),
    windDirectionDeg: toNumberOrNull(current.wind_degree),
    weatherCondition: current.condition && typeof current.condition.text === 'string' ? current.condition.text : null,
    visibility: null, // never invented — see WEATHER_PROVIDER.md's mapped-field list
    rainfallIntensity: null, // WeatherAPI has no qualitative rainfall category, same as IMD
    warningLevel: null, // current.json carries no warnings; alerts.json is not integrated
    rawSourceRecord: raw,
  };

  return { valid: true, reason: null, normalized };
}

module.exports = { normalizeWeatherApiCurrent };
