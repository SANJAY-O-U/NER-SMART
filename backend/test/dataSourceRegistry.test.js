const test = require('node:test');
const assert = require('node:assert/strict');
const { registerSource, getSource, listSources, STATUSES } = require('../src/services/dataSourceRegistry');

test('registerSource rejects a status outside the documented STATUSES enum', () => {
  assert.throws(() => registerSource('TEST_SOURCE_INVALID', { status: 'ONLINE' }), /Invalid data source status/);
});

test('registerSource accepts every documented status', () => {
  for (const status of STATUSES) {
    assert.doesNotThrow(() => registerSource(`TEST_SOURCE_${status}`, { status }));
  }
});

test('getSource returns null for a name that was never registered', () => {
  assert.equal(getSource('TEST_SOURCE_NEVER_REGISTERED'), null);
});

test('registerSource defaults lastUpdated to now when not supplied', () => {
  const before = Date.now();
  registerSource('TEST_SOURCE_TIMESTAMP', { status: 'LIVE' });
  const entry = getSource('TEST_SOURCE_TIMESTAMP');
  assert.ok(entry.lastUpdated.getTime() >= before);
});

test('registerSource overwrites a prior entry rather than accumulating duplicates (e.g. UNAVAILABLE -> LIVE after a successful ingestion pass)', () => {
  registerSource('TEST_SOURCE_WEATHERAPI', { status: 'UNAVAILABLE', error: 'no_credentials' });
  registerSource('TEST_SOURCE_WEATHERAPI', { status: 'LIVE', error: null });

  const entry = getSource('TEST_SOURCE_WEATHERAPI');
  assert.equal(entry.status, 'LIVE');
  assert.equal(entry.error, null);
  assert.equal(listSources().filter((s) => s.name === 'TEST_SOURCE_WEATHERAPI').length, 1);
});

test('listSources reflects every currently registered source, each keyed by its own name', () => {
  registerSource('TEST_SOURCE_A', { status: 'LIVE' });
  registerSource('TEST_SOURCE_B', { status: 'UNAVAILABLE' });
  const names = listSources().map((s) => s.name);
  assert.ok(names.includes('TEST_SOURCE_A'));
  assert.ok(names.includes('TEST_SOURCE_B'));
});
