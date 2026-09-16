const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRoadFeature, geometryMidpoint } = require('../src/services/geoValidation');

test('accepts a valid LineString road feature', () => {
  const feature = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[91.7, 26.1], [91.8, 26.2]] },
    properties: { Name: 'NH 27' },
  };
  const result = validateRoadFeature(feature);
  assert.equal(result.valid, true);
  assert.equal(result.reason, null);
});

test('accepts a valid MultiLineString road feature', () => {
  const feature = {
    type: 'Feature',
    geometry: {
      type: 'MultiLineString',
      coordinates: [
        [[91.7, 26.1], [91.8, 26.2]],
        [[91.9, 26.3], [92.0, 26.4]],
      ],
    },
    properties: { Name: 'NH 29' },
  };
  const result = validateRoadFeature(feature);
  assert.equal(result.valid, true);
});

test('rejects a feature with fewer than 2 coordinate pairs', () => {
  const feature = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[91.7, 26.1]] },
    properties: { Name: 'NH 27' },
  };
  const result = validateRoadFeature(feature);
  assert.equal(result.valid, false);
});

test('rejects out-of-range coordinates', () => {
  const feature = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[200, 26.1], [91.8, 26.2]] },
    properties: { Name: 'NH 27' },
  };
  const result = validateRoadFeature(feature);
  assert.equal(result.valid, false);
});

test('rejects an unsupported geometry type (e.g. Point)', () => {
  const feature = {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [91.7, 26.1] },
    properties: { Name: 'NH 27' },
  };
  const result = validateRoadFeature(feature);
  assert.equal(result.valid, false);
  assert.match(result.reason, /unsupported geometry type/);
});

test('rejects a feature with no name property', () => {
  const feature = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[91.7, 26.1], [91.8, 26.2]] },
    properties: {},
  };
  const result = validateRoadFeature(feature);
  assert.equal(result.valid, false);
  assert.match(result.reason, /Name/);
});

test('rejects a non-Feature object', () => {
  const result = validateRoadFeature({ type: 'FeatureCollection', features: [] });
  assert.equal(result.valid, false);
});

test('rejects null/undefined input without throwing', () => {
  assert.equal(validateRoadFeature(null).valid, false);
  assert.equal(validateRoadFeature(undefined).valid, false);
});

test('geometryMidpoint picks the middle coordinate of a LineString', () => {
  const geometry = {
    type: 'LineString',
    coordinates: [[91.0, 26.0], [91.5, 26.5], [92.0, 27.0]],
  };
  const mid = geometryMidpoint(geometry);
  assert.equal(mid.lng, 91.5);
  assert.equal(mid.lat, 26.5);
});

test('geometryMidpoint flattens a MultiLineString before picking the midpoint', () => {
  const geometry = {
    type: 'MultiLineString',
    coordinates: [
      [[91.0, 26.0], [91.5, 26.5]],
      [[92.0, 27.0], [92.5, 27.5]],
    ],
  };
  const mid = geometryMidpoint(geometry);
  // flattened: [91,26],[91.5,26.5],[92,27],[92.5,27.5] -> index 2
  assert.equal(mid.lng, 92.0);
  assert.equal(mid.lat, 27.0);
});
