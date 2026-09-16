const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyGpsQuality,
  classifyRoadDistance,
  classifyRoadMatchConfidence,
  GPS_ACCURACY_THRESHOLDS_M,
  ROAD_DISTANCE_THRESHOLDS_M,
} = require('../src/services/locationMatchService');
const { isValidLat, isValidLng } = require('../src/controllers/locationController');

// --- coordinate validation ---

test('isValidLat accepts valid latitudes', () => {
  assert.equal(isValidLat(26.1445), true);
  assert.equal(isValidLat(-90), true);
  assert.equal(isValidLat(90), true);
  assert.equal(isValidLat(0), true);
});

test('isValidLat rejects out-of-range or non-numeric latitude', () => {
  assert.equal(isValidLat(91), false);
  assert.equal(isValidLat(-91), false);
  assert.equal(isValidLat(NaN), false);
});

test('isValidLng accepts valid longitudes', () => {
  assert.equal(isValidLng(91.7362), true);
  assert.equal(isValidLng(-180), true);
  assert.equal(isValidLng(180), true);
});

test('isValidLng rejects out-of-range or non-numeric longitude', () => {
  assert.equal(isValidLng(181), false);
  assert.equal(isValidLng(-181), false);
  assert.equal(isValidLng(NaN), false);
});

// --- GPS quality tiers ---

test('classifyGpsQuality returns HIGH within the HIGH threshold', () => {
  assert.equal(classifyGpsQuality(GPS_ACCURACY_THRESHOLDS_M.HIGH), 'HIGH');
  assert.equal(classifyGpsQuality(5), 'HIGH');
});

test('classifyGpsQuality returns MEDIUM between HIGH and MEDIUM thresholds', () => {
  assert.equal(classifyGpsQuality(GPS_ACCURACY_THRESHOLDS_M.HIGH + 1), 'MEDIUM');
  assert.equal(classifyGpsQuality(GPS_ACCURACY_THRESHOLDS_M.MEDIUM), 'MEDIUM');
});

test('classifyGpsQuality returns LOW beyond the MEDIUM threshold', () => {
  assert.equal(classifyGpsQuality(GPS_ACCURACY_THRESHOLDS_M.MEDIUM + 1), 'LOW');
  assert.equal(classifyGpsQuality(500), 'LOW');
});

test('classifyGpsQuality returns null (not LOW) when accuracy is missing — missing is a distinct case', () => {
  assert.equal(classifyGpsQuality(null), null);
  assert.equal(classifyGpsQuality(undefined), null);
});

// --- road distance tiers ---

test('classifyRoadDistance returns NONE beyond the LOW threshold (no safe match)', () => {
  assert.equal(classifyRoadDistance(ROAD_DISTANCE_THRESHOLDS_M.LOW + 1), 'NONE');
  assert.equal(classifyRoadDistance(2_000_000), 'NONE'); // e.g. Mumbai vs the NER corridor
});

test('classifyRoadDistance returns HIGH/MEDIUM/LOW at the right boundaries', () => {
  assert.equal(classifyRoadDistance(10), 'HIGH');
  assert.equal(classifyRoadDistance(200), 'MEDIUM');
  assert.equal(classifyRoadDistance(10000), 'LOW');
});

// --- combined confidence: the mission's own worked examples ---

test('excellent GPS + tiny road distance = HIGH (mission worked example)', () => {
  assert.equal(classifyRoadMatchConfidence({ distanceMeters: 4, gpsAccuracyMeters: 8 }), 'HIGH');
});

test('poor GPS + tiny road distance must NOT be HIGH (mission worked example)', () => {
  const confidence = classifyRoadMatchConfidence({ distanceMeters: 5, gpsAccuracyMeters: 150 });
  assert.notEqual(confidence, 'HIGH');
  assert.equal(confidence, 'LOW');
});

test('confidence is capped at MEDIUM when GPS accuracy is not supplied, even for a very close road', () => {
  const confidence = classifyRoadMatchConfidence({ distanceMeters: 1, gpsAccuracyMeters: null });
  assert.equal(confidence, 'MEDIUM');
});

test('confidence is NONE when the road is beyond the distance threshold, regardless of GPS quality', () => {
  const confidence = classifyRoadMatchConfidence({ distanceMeters: 2_000_000, gpsAccuracyMeters: 5 });
  assert.equal(confidence, 'NONE');
});

test('moderate GPS + moderate distance yields MEDIUM, not HIGH', () => {
  const confidence = classifyRoadMatchConfidence({ distanceMeters: 200, gpsAccuracyMeters: 50 });
  assert.equal(confidence, 'MEDIUM');
});
