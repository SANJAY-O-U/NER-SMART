const test = require('node:test');
const assert = require('node:assert');
const DisasterAlert = require('../src/models/DisasterAlert');
const { runScheduledSachetPass, expireOldAlerts } = require('../src/controllers/sachetController');

// Phase 8B.1: a scheduled SACHET pass must expire stored alerts even when
// the feed fetch fails, and must never fabricate data or delete history.

const silent = { log() {}, warn() {}, error() {} };

function spyDeps(ingestImpl) {
  const calls = { persisted: [], expire: 0 };
  return {
    calls,
    deps: {
      ingest: ingestImpl,
      persist: async (a) => { calls.persisted.push(a.identifier); },
      expire: async () => { calls.expire += 1; return 2; },
      logger: silent,
    },
  };
}

test('A. successful ingestion persists alerts and then expires', async () => {
  const { calls, deps } = spyDeps(async () => ({ status: 'LIVE', alerts: [{ identifier: 'a1' }, { identifier: 'a2' }], totalCandidates: 2 }));
  const r = await runScheduledSachetPass(deps);
  assert.deepStrictEqual(calls.persisted, ['a1', 'a2']);
  assert.strictEqual(calls.expire, 1);
  assert.deepStrictEqual(r, { status: 'LIVE', persisted: 2, expiredCount: 2 });
});

test('A2. unchanged feed still expires (existing behavior preserved)', async () => {
  const { calls, deps } = spyDeps(async () => ({ status: 'LIVE', unchanged: true, alerts: [] }));
  const r = await runScheduledSachetPass(deps);
  assert.strictEqual(calls.expire, 1);
  assert.strictEqual(r.status, 'UNCHANGED');
});

test('B. UNAVAILABLE / timeout: nothing persisted, expiry STILL runs', async () => {
  const { calls, deps } = spyDeps(async () => ({ status: 'UNAVAILABLE', errors: ['timeout'], alerts: [] }));
  const r = await runScheduledSachetPass(deps);
  assert.deepStrictEqual(calls.persisted, []);
  assert.strictEqual(calls.expire, 1);
  assert.deepStrictEqual(r, { status: 'UNAVAILABLE', persisted: 0, expiredCount: 2 });
});

test('B2. thrown fetch error: nothing persisted, expiry STILL runs, never throws', async () => {
  const { calls, deps } = spyDeps(async () => { throw new Error('socket hang up'); });
  const r = await runScheduledSachetPass(deps);
  assert.deepStrictEqual(calls.persisted, []);
  assert.strictEqual(calls.expire, 1);
  assert.strictEqual(r.status, 'FAILED');
});

test('B3. an expiry failure is contained (scheduler never crashes)', async () => {
  const r = await runScheduledSachetPass({
    ingest: async () => ({ status: 'UNAVAILABLE', errors: ['timeout'] }),
    persist: async () => {},
    expire: async () => { throw new Error('db down'); },
    logger: silent,
  });
  assert.deepStrictEqual(r, { status: 'UNAVAILABLE', persisted: 0, expiredCount: null });
});

// C/D/E exercise the real expireOldAlerts against stubbed model methods.
function stubDisasterAlert(candidates) {
  const orig = { find: DisasterAlert.find, updateMany: DisasterAlert.updateMany, deleteMany: DisasterAlert.deleteMany, deleteOne: DisasterAlert.deleteOne };
  const calls = { updateMany: [], deleted: 0, findFilter: null };
  DisasterAlert.find = async (filter) => { calls.findFilter = filter; return candidates; };
  DisasterAlert.updateMany = async (filter, update) => { calls.updateMany.push({ filter, update }); return { modifiedCount: filter._id.$in.length }; };
  DisasterAlert.deleteMany = async () => { calls.deleted += 1; };
  DisasterAlert.deleteOne = async () => { calls.deleted += 1; };
  return { calls, restore: () => Object.assign(DisasterAlert, orig) };
}

const HOUR = 3600 * 1000;
const past = new Date(Date.now() - 2 * HOUR);
const future = new Date(Date.now() + 2 * HOUR);

test('C/D. only alerts past their expiry are marked EXPIRED; future ones stay active', async () => {
  const { calls, restore } = stubDisasterAlert([
    { _id: 'expired1', expires: past, sent: new Date(Date.now() - 5 * HOUR), firstSeenAt: new Date(Date.now() - 5 * HOUR) },
    { _id: 'current1', expires: future, sent: new Date(Date.now() - HOUR), firstSeenAt: new Date(Date.now() - HOUR) },
  ]);
  try {
    const n = await expireOldAlerts();
    assert.strictEqual(n, 1);
    assert.deepStrictEqual(calls.findFilter, { lifecycleStatus: { $in: ['ACTIVE', 'UPDATED'] } }); // already-EXPIRED records are never re-touched
    assert.deepStrictEqual(calls.updateMany, [{ filter: { _id: { $in: ['expired1'] } }, update: { $set: { lifecycleStatus: 'EXPIRED' } } }]);
  } finally { restore(); }
});

test('C2. nothing to expire -> no write at all', async () => {
  const { calls, restore } = stubDisasterAlert([{ _id: 'current1', expires: future, sent: new Date(), firstSeenAt: new Date() }]);
  try {
    assert.strictEqual(await expireOldAlerts(), 0);
    assert.strictEqual(calls.updateMany.length, 0);
  } finally { restore(); }
});

test('E. expiry never deletes historical records — lifecycle update only', async () => {
  const { calls, restore } = stubDisasterAlert([{ _id: 'expired1', expires: past, sent: past, firstSeenAt: past }]);
  try {
    await runScheduledSachetPass({ ingest: async () => ({ status: 'UNAVAILABLE', errors: ['timeout'] }), logger: silent });
    assert.strictEqual(calls.deleted, 0);
    assert.strictEqual(calls.updateMany.length, 1);
    assert.deepStrictEqual(Object.keys(calls.updateMany[0].update.$set), ['lifecycleStatus']); // no sourceStatus/LIVE fabrication
  } finally { restore(); }
});
