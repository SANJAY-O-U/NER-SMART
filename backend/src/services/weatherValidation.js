/**
 * Pure functions that validate and normalize IMD API responses into our
 * WeatherObservation shape. No network calls, no DB — fully unit-testable
 * against fixtures built from IMD's own documented response formats
 * (https://api.imd.gov.in/public/api_reference.html, fetched 2026-09-15).
 *
 * IMPORTANT: as of this writing these functions have never been run
 * against a REAL live response — only against fixtures — because
 * IMD_ACCESS = NOT_VERIFIED (see IMD_INTEGRATION.md). Treat them as
 * "ready, not proven" until exercised against a real authenticated call.
 */

// IMD "Weather Code" -> human-readable condition. Not exhaustive — only
// the ranges relevant to road risk are named; everything else falls back
// to a generic label rather than guessing.
function decodeWeatherCode(code) {
  const n = Number(code);
  if (Number.isNaN(n)) return null;
  if (n >= 60 && n <= 69) return 'RAIN';
  if (n >= 80 && n <= 82) return 'RAIN_SHOWERS';
  if (n >= 17 && n <= 19) return 'THUNDERSTORM';
  if (n >= 91 && n <= 99) return 'THUNDERSTORM';
  if (n >= 70 && n <= 79) return 'SNOW';
  if (n >= 30 && n <= 39) return 'DUSTSTORM';
  if (n >= 40 && n <= 49) return 'FOG';
  if (n === 0 || n === 1 || n === 2) return 'CLEAR_OR_STABLE';
  return `IMD_CODE_${n}`;
}

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
 * Normalizes a "Current Weather API" (api-3) record.
 * Documented fields: Station Id, Station, Date of Observation (YYYY-mm-dd),
 * Time of Observation (UTC), M.S.L.P, Wind Direction, Wind Speed (KMPH),
 * Temperature, Weather Code, Nebulosity, Humidity, Last 24 hrs Rainfall.
 * NOTE: this endpoint does NOT return latitude/longitude — station
 * coordinates must come from a separate station-mapping lookup, which is
 * why `location` is left null here unless the caller supplies it.
 */
function normalizeCurrentWx(raw, { stationLat = null, stationLng = null } = {}) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'response is not an object' };
  }

  const stationId = raw['Station Id'] ?? raw.Station_Id ?? raw.station_id;
  if (!stationId) return { valid: false, reason: 'missing Station Id' };

  const dateObs = raw['Date of Observation'];
  const timeObs = raw['Time of Observation']; // UTC, format not fully specified in docs
  let observedAt = null;
  if (dateObs) {
    const parsed = new Date(timeObs ? `${dateObs}T${timeObs}Z` : `${dateObs}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) observedAt = parsed;
  }

  const hasLocation = stationLat !== null && stationLng !== null;
  if (hasLocation && !isValidLatLng(stationLat, stationLng)) {
    return { valid: false, reason: 'invalid supplied station coordinates' };
  }

  const normalized = {
    source: 'IMD_CURRENT_WX',
    sourceRecordId: String(stationId),
    stationName: raw.Station || null,
    observedAt,
    location: hasLocation ? { type: 'Point', coordinates: [stationLng, stationLat] } : null,
    temperatureC: toNumberOrNull(raw.Temperature),
    humidityPct: toNumberOrNull(raw.Humidity),
    rainfallMm: toNumberOrNull(raw['Last 24 hrs Rainfall']),
    windSpeedKmph: toNumberOrNull(raw['Wind Speed']),
    windDirectionDeg: toNumberOrNull(raw['Wind Direction']),
    weatherCondition: decodeWeatherCode(raw['Weather Code']),
    visibility: null, // not provided by this endpoint — never fabricated
    rainfallIntensity: null, // not provided by this endpoint
    warningLevel: null, // comes from a separate warning endpoint
    rawSourceRecord: raw,
  };

  return { valid: true, reason: null, normalized };
}

/**
 * Normalizes an "AWS/ARG Data" (api-9) record — this endpoint DOES
 * include Latitude/Longitude directly, so it's the preferred source for
 * anything that needs to be spatially associated with a road.
 */
function normalizeAwsData(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'response is not an object' };
  }

  const stationId = raw.ID ?? raw.CALL_SIGN;
  if (!stationId) return { valid: false, reason: 'missing station ID (ID/CALL_SIGN)' };

  const lat = toNumberOrNull(raw.Latitude);
  const lng = toNumberOrNull(raw.Longitude);
  if (!isValidLatLng(lat, lng)) {
    return { valid: false, reason: 'missing or invalid Latitude/Longitude' };
  }

  let observedAt = null;
  if (raw.DATE && raw.TIME) {
    const parsed = new Date(`${raw.DATE}T${raw.TIME}Z`);
    if (!Number.isNaN(parsed.getTime())) observedAt = parsed;
  }

  const normalized = {
    source: 'IMD_AWS',
    sourceRecordId: String(stationId),
    stationName: raw.STATION || raw.CALL_SIGN || null,
    observedAt,
    location: { type: 'Point', coordinates: [lng, lat] },
    state: raw.STATE || null,
    district: raw.DISTRICT || null,
    temperatureC: toNumberOrNull(raw.CURR_TEMP),
    humidityPct: toNumberOrNull(raw.RH),
    rainfallMm: null, // this endpoint does not document a rainfall field
    windSpeedKmph: toNumberOrNull(raw.WIND_SPEED),
    windDirectionDeg: toNumberOrNull(raw.WIND_DIRECTION),
    weatherCondition: decodeWeatherCode(raw.WEATHER_CODE),
    visibility: null,
    rainfallIntensity: null,
    warningLevel: null,
    rawSourceRecord: raw,
  };

  return { valid: true, reason: null, normalized };
}

/**
 * Normalizes a "District-wise Warnings" (api-6) record into a warning
 * level string. This does not produce a full WeatherObservation on its
 * own — callers merge `warningLevel` onto a nearby observation, or use
 * it standalone when no station observation is available for the area.
 */
const WARNING_CODE_LABEL = {
  1: 'NO_WARNING',
  2: 'HEAVY_RAIN',
  3: 'HEAVY_SNOW',
  4: 'THUNDERSTORM_LIGHTNING',
  5: 'HAILSTORM',
  6: 'DUST_STORM',
  7: 'DUST_RAISING_WINDS',
  8: 'STRONG_SURFACE_WINDS',
  9: 'HEAT_WAVE',
  10: 'HOT_DAY',
  11: 'WARM_NIGHT',
  12: 'COLD_WAVE',
  13: 'COLD_DAY',
  14: 'GROUND_FROST',
  15: 'FOG',
  16: 'VERY_HEAVY_RAIN',
  17: 'EXTREMELY_HEAVY_RAIN',
};

function normalizeDistrictWarning(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'response is not an object' };
  }
  if (!raw.District || !raw.Day_1) {
    return { valid: false, reason: 'missing District or Day_1 warning code' };
  }
  const codes = String(raw.Day_1).split(',').map((c) => c.trim());
  const labels = codes.map((c) => WARNING_CODE_LABEL[Number(c)] || `UNKNOWN_CODE_${c}`);
  return {
    valid: true,
    reason: null,
    normalized: {
      district: raw.District,
      date: raw.Date || null,
      warningLevel: labels.join(', '),
      rawSourceRecord: raw,
    },
  };
}

module.exports = {
  normalizeCurrentWx,
  normalizeAwsData,
  normalizeDistrictWarning,
  decodeWeatherCode,
  WARNING_CODE_LABEL,
};
