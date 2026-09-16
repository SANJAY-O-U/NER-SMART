const test = require('node:test');
const assert = require('node:assert/strict');
const { confidenceForDistance, haversineKm, CONFIDENCE_THRESHOLDS_KM } = require('../src/services/geoService');

test('confidenceForDistance returns HIGH within the HIGH threshold', () => {
  assert.equal(confidenceForDistance(0), 'HIGH');
  assert.equal(confidenceForDistance(CONFIDENCE_THRESHOLDS_KM.HIGH), 'HIGH');
});

test('confidenceForDistance returns MEDIUM between HIGH and MEDIUM thresholds', () => {
  const justOverHigh = CONFIDENCE_THRESHOLDS_KM.HIGH + 0.1;
  assert.equal(confidenceForDistance(justOverHigh), 'MEDIUM');
  assert.equal(confidenceForDistance(CONFIDENCE_THRESHOLDS_KM.MEDIUM), 'MEDIUM');
});

test('confidenceForDistance returns LOW between MEDIUM and LOW thresholds', () => {
  const justOverMedium = CONFIDENCE_THRESHOLDS_KM.MEDIUM + 0.1;
  assert.equal(confidenceForDistance(justOverMedium), 'LOW');
  assert.equal(confidenceForDistance(CONFIDENCE_THRESHOLDS_KM.LOW), 'LOW');
});

test('confidenceForDistance returns NONE beyond the LOW threshold', () => {
  const wayOver = CONFIDENCE_THRESHOLDS_KM.LOW + 50;
  assert.equal(confidenceForDistance(wayOver), 'NONE');
});

test('haversineKm returns ~0 for identical points', () => {
  const d = haversineKm(26.1445, 91.7362, 26.1445, 91.7362);
  assert.ok(d < 0.001);
});

test('haversineKm returns a plausible distance between Guwahati and Imphal', () => {
  // Straight-line (great-circle) distance, NOT road distance — the road
  // corridor (NH27/NH29/NH2) is considerably longer at ~450km.
  const d = haversineKm(26.1445, 91.7362, 24.817, 93.9368);
  assert.ok(d > 240 && d < 290, `expected ~240-290km straight-line, got ${d}`);
});
