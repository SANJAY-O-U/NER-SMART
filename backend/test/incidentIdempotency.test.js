const test = require('node:test');
const assert = require('node:assert/strict');
const Incident = require('../src/models/Incident');

test('Incident schema defines clientEventId with a default of null (backward compatible)', () => {
  const path = Incident.schema.path('clientEventId');
  assert.ok(path, 'clientEventId field should exist on the schema');
  assert.equal(path.defaultValue, null);
});

test('Incident schema has a unique, partial (sparse-equivalent) index on clientEventId', () => {
  const indexes = Incident.schema.indexes();
  const clientEventIdIndex = indexes.find(([def]) => def.clientEventId === 1);
  assert.ok(clientEventIdIndex, 'expected an index on clientEventId');
  const [, options] = clientEventIdIndex;
  assert.equal(options.unique, true);
  assert.ok(
    options.partialFilterExpression,
    'index must be partial so incidents without a clientEventId (SIMULATION/AUTHORITY-sourced, pre-Phase-5 DRIVER_APP) remain valid'
  );
});

test('a new Incident document without clientEventId remains valid (backward compatibility)', () => {
  const doc = new Incident({ type: 'ROAD_DAMAGE', lat: 26.1, lng: 91.7 });
  const err = doc.validateSync();
  assert.equal(err, undefined);
  assert.equal(doc.clientEventId, null);
});

test('a new Incident document with a clientEventId validates cleanly', () => {
  const doc = new Incident({ type: 'ROAD_DAMAGE', lat: 26.1, lng: 91.7, clientEventId: 'a1b2c3d4-uuid' });
  const err = doc.validateSync();
  assert.equal(err, undefined);
  assert.equal(doc.clientEventId, 'a1b2c3d4-uuid');
});
