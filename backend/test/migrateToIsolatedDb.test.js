const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const m = require('../scripts/migrateToIsolatedDb');

// Phase 8B.3.1: safety properties of the isolated-DB migration script.
// None of these tests connect to MongoDB.

const SCRIPT_SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrateToIsolatedDb.js'), 'utf8');

test('default invocation is a dry run and refuses writes', () => {
  const opts = m.parseArgs([]);
  assert.strictEqual(opts.mode, 'dry-run');
  assert.match(m.writeRefusal(opts), /dry run/);
  assert.strictEqual(m.parseArgs(['--dry-run']).mode, 'dry-run');
});

test('--execute without --confirm-target refuses', () => {
  assert.match(m.writeRefusal(m.parseArgs(['--execute'])), /requires --confirm-target=ner-smart-prod/);
  assert.match(m.writeRefusal(m.parseArgs(['--execute', '--confirm-target='])), /requires --confirm-target/);
});

test('--execute with a wrong confirm-target refuses', () => {
  for (const t of ['test', 'ner-smart-dev', 'NER-SMART-PROD', 'ner-smart-prod ']) {
    assert.match(m.writeRefusal(m.parseArgs(['--execute', `--confirm-target=${t}`])), /must be exactly "ner-smart-prod"/, t);
  }
});

test('only --execute --confirm-target=ner-smart-prod permits writing', () => {
  assert.strictEqual(m.writeRefusal(m.parseArgs(['--execute', '--confirm-target=ner-smart-prod'])), null);
  assert.notStrictEqual(m.writeRefusal(m.parseArgs(['--confirm-target=ner-smart-prod'])), null); // confirm alone is not execute
});

test('--dry-run and --execute together are rejected', () => {
  assert.throws(() => m.parseArgs(['--dry-run', '--execute', '--confirm-target=ner-smart-prod']), /mutually exclusive/);
});

test('unknown / destructive flags are rejected', () => {
  for (const f of ['--drop', '--delete', '--overwrite', '--clean', '--reset', '--upsert', '--force', '--collections=users']) {
    assert.throws(() => m.parseArgs([f]), /Unknown option/, f);
  }
});

test('target other than ner-smart-prod refuses', () => {
  assert.doesNotThrow(() => m.assertTargetDb('ner-smart-prod'));
  for (const d of ['test', 'ner-smart-dev', 'travel-platform', '']) assert.throws(() => m.assertTargetDb(d), /must be exactly "ner-smart-prod"/, d);
});

test('source other than test refuses', () => {
  assert.doesNotThrow(() => m.assertSourceDb('test'));
  for (const d of ['ner-smart-prod', 'ner-smart-dev', 'travel-platform', '']) assert.throws(() => m.assertSourceDb(d), /must be exactly "test"/, d);
});

test('target user must have exactly readWrite@ner-smart-prod', () => {
  assert.doesNotThrow(() => m.assertTargetRoles([{ role: 'readWrite', db: 'ner-smart-prod' }]));
  assert.throws(() => m.assertTargetRoles([{ role: 'readWriteAnyDatabase', db: 'admin' }, { role: 'readWrite', db: 'ner-smart-prod' }]));
  assert.throws(() => m.assertTargetRoles([{ role: 'atlasAdmin', db: 'admin' }]));
  assert.throws(() => m.assertTargetRoles([{ role: 'readWrite', db: 'ner-smart-dev' }]));
  assert.throws(() => m.assertTargetRoles([]));
});

test('allowlist is exactly the five approved collections; nothing else can be selected', () => {
  assert.deepStrictEqual(m.MIGRATE.map((p) => p.name), ['roads', 'weatherobservations', 'disasteralerts', 'warehouses', 'hospitals']);
  assert.deepStrictEqual([...m.EXCLUDE], ['incidents', 'alerts', 'shipments', 'vehicles']);
  for (const n of [...m.EXCLUDE, 'users', 'members', 'ledgertransactions', 'travelpackages']) assert.throws(() => m.getPlan(n), /not in the migration allowlist/, n);
  assert.ok(Object.isFrozen(m.MIGRATE) && m.MIGRATE.every(Object.isFrozen));
});

test('filters: roads exclude demo roads (source: null); others copy everything', () => {
  assert.deepStrictEqual(m.getPlan('roads').filter, { source: { $ne: null } });
  assert.strictEqual(m.getPlan('roads').expectedCount, 260);
  for (const n of ['weatherobservations', 'disasteralerts', 'warehouses', 'hospitals']) assert.deepStrictEqual(m.getPlan(n).filter, {}, n);
  assert.strictEqual(m.getPlan('warehouses').expectedCount, 3);
  assert.strictEqual(m.getPlan('hospitals').expectedCount, 3);
  assert.strictEqual(m.getPlan('weatherobservations').expectedCount, null); // snapshot-dependent
  assert.strictEqual(m.getPlan('disasteralerts').expectedCount, null);
});

test('index manifest matches the Mongoose schema definitions', () => {
  assert.deepStrictEqual(m.getPlan('roads').indexes, [{ name: 'geometry_2dsphere', key: { geometry: '2dsphere' } }]);
  assert.deepStrictEqual(m.getPlan('weatherobservations').indexes.map((i) => i.name), ['location_2dsphere', 'source_1_sourceRecordId_1_observedAt_1']);
  const uniq = m.getPlan('weatherobservations').indexes[1];
  assert.strictEqual(uniq.unique, true);
  assert.deepStrictEqual(uniq.partialFilterExpression, { sourceRecordId: { $type: 'string' } });
  assert.deepStrictEqual(m.getPlan('disasteralerts').indexes, [{ name: 'identifier_1', key: { identifier: 1 }, unique: true }]);
  assert.deepStrictEqual(m.getPlan('warehouses').indexes, []);
  assert.deepStrictEqual(m.getPlan('hospitals').indexes, []);
});

test('_id preservation is enabled and documents are not transformed', () => {
  assert.strictEqual(m.PRESERVE_IDS, true);
  // The only insert passes the source documents straight through.
  assert.match(SCRIPT_SRC, /insertMany\(docs, \{ ordered: true \}\)/);
  assert.doesNotMatch(SCRIPT_SRC, /delete\s+\w+\._id|_id\s*=\s*new|new ObjectId\(/);
});

test('script contains no destructive or update operations', () => {
  const forbidden = /\.(drop|dropDatabase|dropCollection|dropIndex|dropIndexes|deleteMany|deleteOne|updateMany|updateOne|replaceOne|findOneAndUpdate|findOneAndReplace|findOneAndDelete|bulkWrite|rename)\s*\(/;
  assert.doesNotMatch(SCRIPT_SRC, forbidden);
  assert.doesNotMatch(SCRIPT_SRC, /upsert\s*:/);
  // The only write calls are createIndex and insertMany.
  const writes = SCRIPT_SRC.match(/\.(createIndex|insertMany|insertOne|save)\s*\(/g) || [];
  assert.deepStrictEqual([...new Set(writes.map((w) => w.replace(/\s*\($/, '(')))].sort(), ['.createIndex(', '.insertMany(']);
});

test('script never loads dotenv or Mongoose models (no implicit config or autoIndex)', () => {
  assert.doesNotMatch(SCRIPT_SRC, /require\(['"]dotenv|require\(['"]mongoose|src\/models/);
});

test('refusals happen before any connection attempt', async () => {
  // No URIs supplied: an execute without confirmation must refuse first, not fail to connect.
  await assert.rejects(m.main(['--execute'], {}), /Refusing to write: --execute requires --confirm-target/);
  await assert.rejects(m.main(['--execute', '--confirm-target=test'], {}), /Refusing to write/);
  await assert.rejects(m.main(['--drop'], {}), /Unknown option/);
  // A dry run with no URIs fails on the missing source, never reaching a database.
  await assert.rejects(m.main([], {}), /Source connection string not provided/);
});

test('sanitize strips connection strings and Atlas hosts', () => {
  const s = m.sanitize('failed mongodb+srv://user:pw@cluster0.abcde.mongodb.net/x?y=1 and ac-1-shard-00-00.abcde.mongodb.net');
  assert.ok(!s.includes('user:pw') && !s.includes('abcde'));
});
