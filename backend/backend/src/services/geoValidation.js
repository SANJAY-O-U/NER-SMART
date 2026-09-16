/**
 * Pure validation for a single GeoJSON road feature, used by the road
 * import script (and unit-tested independently of MongoDB/network).
 *
 * Returns { valid: true, reason: null } or { valid: false, reason: '...' }.
 * Never throws.
 */

const VALID_GEOMETRY_TYPES = ['LineString', 'MultiLineString'];

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isValidLngLat(pair) {
  return (
    Array.isArray(pair) &&
    pair.length >= 2 &&
    isFiniteNumber(pair[0]) &&
    isFiniteNumber(pair[1]) &&
    pair[0] >= -180 &&
    pair[0] <= 180 &&
    pair[1] >= -90 &&
    pair[1] <= 90
  );
}

function validateLineStringCoords(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return false;
  return coords.every(isValidLngLat);
}

function validateGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') {
    return { valid: false, reason: 'missing geometry' };
  }
  if (!VALID_GEOMETRY_TYPES.includes(geometry.type)) {
    return { valid: false, reason: `unsupported geometry type: ${geometry.type}` };
  }
  if (geometry.type === 'LineString') {
    if (!validateLineStringCoords(geometry.coordinates)) {
      return { valid: false, reason: 'invalid LineString coordinates' };
    }
    return { valid: true, reason: null };
  }
  // MultiLineString: array of LineString coordinate arrays
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    return { valid: false, reason: 'invalid MultiLineString coordinates' };
  }
  const allValid = geometry.coordinates.every(validateLineStringCoords);
  if (!allValid) return { valid: false, reason: 'invalid MultiLineString coordinates' };
  return { valid: true, reason: null };
}

/**
 * Validates a full GeoJSON Feature intended to become a Road document.
 * `nameField` lets callers point at whichever property holds the road
 * name in their source dataset (defaults to 'Name', matching the
 * datta07/INDIAN-SHAPEFILES national-highway export used in Phase 1).
 */
function validateRoadFeature(feature, { nameField = 'Name' } = {}) {
  if (!feature || typeof feature !== 'object') {
    return { valid: false, reason: 'feature is not an object' };
  }
  if (feature.type !== 'Feature') {
    return { valid: false, reason: `expected type "Feature", got "${feature.type}"` };
  }

  const geomResult = validateGeometry(feature.geometry);
  if (!geomResult.valid) return geomResult;

  const name = feature.properties && feature.properties[nameField];
  if (!name || typeof name !== 'string' || !name.trim()) {
    return { valid: false, reason: `missing or empty "${nameField}" property` };
  }

  return { valid: true, reason: null };
}

/**
 * Midpoint of a LineString/MultiLineString, used to populate the legacy
 * lat/lng fields so existing lat/lng-only consumers keep working.
 */
function geometryMidpoint(geometry) {
  const flat =
    geometry.type === 'LineString'
      ? geometry.coordinates
      : geometry.coordinates.flat();
  const mid = flat[Math.floor(flat.length / 2)];
  return { lng: mid[0], lat: mid[1] };
}

module.exports = { validateRoadFeature, validateGeometry, geometryMidpoint };
