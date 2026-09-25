const test = require('node:test');
const assert = require('node:assert/strict');
const DisasterAlert = require('../src/models/DisasterAlert');

// Mirrors incidentIdempotency.test.js's schema-level approach (no live
// MongoDB connection needed): verifies the dedup guarantee structurally,
// the same way Phase 2's clientEventId uniqueness was verified.

test('DisasterAlert schema requires identifier and enforces it as unique (the CAP dedupe key)', () => {
  const path = DisasterAlert.schema.path('identifier');
  assert.ok(path, 'identifier field should exist on the schema');
  assert.equal(path.isRequired, true);

  const indexes = DisasterAlert.schema.indexes();
  const identifierIndex = indexes.find(([def]) => def.identifier === 1);
  assert.ok(identifierIndex, 'expected a unique index on identifier');
  const [, options] = identifierIndex;
  assert.equal(options.unique, true);
});

test('lifecycleStatus enum covers ACTIVE/EXPIRED/CANCELLED/UPDATED and defaults to ACTIVE', () => {
  const path = DisasterAlert.schema.path('lifecycleStatus');
  assert.deepEqual(path.enumValues.sort(), ['ACTIVE', 'CANCELLED', 'EXPIRED', 'UPDATED'].sort());
  assert.equal(path.defaultValue, 'ACTIVE');
});

test('associationMethod enum only allows the existing district/approximate methods (no invented precise-geometry method)', () => {
  const path = DisasterAlert.schema.path('associationMethod');
  assert.deepEqual(
    path.enumValues.filter(Boolean).sort(),
    ['AREADESC_TEXT_MATCH', 'LGD_DISTRICT_MATCH', 'NEAREST_DISTRICT_HQ_APPROXIMATION'].sort()
  );
});

test('polygon defaults to null and is never required — never fabricated when the polygon endpoint is unavailable', () => {
  const path = DisasterAlert.schema.path('polygon');
  assert.equal(path.defaultValue, null);
  assert.ok(!path.isRequired);
});

test('a new DisasterAlert document with only an identifier validates cleanly (all else optional/nullable)', () => {
  const doc = new DisasterAlert({ identifier: 'IN-TEST-1' });
  const err = doc.validateSync();
  assert.equal(err, undefined);
  assert.equal(doc.lifecycleStatus, 'ACTIVE');
  assert.equal(doc.polygon, null);
});

test('a new DisasterAlert document without an identifier fails validation', () => {
  const doc = new DisasterAlert({ event: 'Flood' });
  const err = doc.validateSync();
  assert.ok(err, 'expected a validation error for missing identifier');
  assert.ok(err.errors.identifier);
});
