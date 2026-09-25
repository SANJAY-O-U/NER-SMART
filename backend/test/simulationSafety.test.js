const test = require('node:test');
const assert = require('node:assert/strict');
const { simulateLandslide, isRoadEligibleForSimulation } = require('../src/controllers/simulationController');

function withEnv(vars, fn) {
  const original = {};
  for (const key of Object.keys(vars)) original[key] = process.env[key];
  Object.assign(process.env, vars);
  return fn().finally(() => {
    for (const key of Object.keys(vars)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

// --- 5. simulation endpoint rejected outside demo mode ---
// This branch returns BEFORE any database call, so it's fully testable
// without a MongoDB connection — and the absence of one here is itself
// proof the guard runs first (a real Road.findById would hang/error
// without a connection, which these tests never establish).

test('simulateLandslide rejects with 403 when APP_MODE is unset', async () => {
  await withEnv({ APP_MODE: '' }, async () => {
    const req = { body: { roadId: '507f1f77bcf86cd799439011' } };
    const res = fakeRes();
    await simulateLandslide(req, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /APP_MODE=demo/);
  });
});

test('simulateLandslide rejects with 403 when APP_MODE=production', async () => {
  await withEnv({ APP_MODE: 'production' }, async () => {
    const req = { body: { roadId: '507f1f77bcf86cd799439011' } };
    const res = fakeRes();
    await simulateLandslide(req, res);
    assert.equal(res.statusCode, 403);
  });
});

// --- 7. real road cannot be modified by demo simulation (pure predicate) ---
// The actual Road.findById()/road.save() path is DB-touching — same
// limitation this codebase already accepts for e.g. sachetRoadAssociation
// (no live MongoDB in this test suite). isRoadEligibleForSimulation is
// the exact, exported condition the controller applies right after
// fetching the road, so this proves the DECISION correctly, and the full
// live path (real road untouched, demo road succeeds, with an actual DB)
// is verified separately — see this phase's live verification.

test('isRoadEligibleForSimulation rejects a real imported road (source set)', () => {
  const realRoad = { source: 'datta07/INDIAN-SHAPEFILES (MIT)', name: 'NH 27' };
  assert.equal(isRoadEligibleForSimulation(realRoad), false);
});

test('isRoadEligibleForSimulation accepts a demo/prototype road (source: null)', () => {
  const demoRoad = { source: null, name: 'NH-2 Guwahati-Imphal Highway' };
  assert.equal(isRoadEligibleForSimulation(demoRoad), true);
});

test('isRoadEligibleForSimulation rejects a missing road', () => {
  assert.equal(isRoadEligibleForSimulation(null), false);
  assert.equal(isRoadEligibleForSimulation(undefined), false);
});

// --- roadId validation, also DB-free ---

test('simulateLandslide rejects a malformed roadId before touching the database', async () => {
  await withEnv({ APP_MODE: 'demo' }, async () => {
    const req = { body: { roadId: 'not-a-real-id' } };
    const res = fakeRes();
    await simulateLandslide(req, res);
    assert.equal(res.statusCode, 422);
  });
});

test('simulateLandslide rejects a missing roadId', async () => {
  await withEnv({ APP_MODE: 'demo' }, async () => {
    const req = { body: {} };
    const res = fakeRes();
    await simulateLandslide(req, res);
    assert.equal(res.statusCode, 422);
  });
});
