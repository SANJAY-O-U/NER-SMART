const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { seedCliRefusal } = require('../src/seed/seed');
const { isDemoResetAllowed } = require('../src/controllers/demoController');

// Phase 8B.1: `npm run seed` wipes demo-owned collections in whatever
// database MONGO_URI names, so it must refuse unless APP_MODE=demo — and
// refuse BEFORE opening any database connection.

const SEED = path.join(__dirname, '..', 'src', 'seed', 'seed.js');

test('seedCliRefusal allows only APP_MODE=demo', () => {
  assert.strictEqual(seedCliRefusal('demo'), null);
  for (const mode of ['production', 'development', 'staging', 'Demo', '', undefined]) {
    const msg = seedCliRefusal(mode);
    assert.ok(msg && msg.startsWith('Refusing to seed'), `mode=${mode}`);
    assert.ok(msg.includes('APP_MODE=demo'));
  }
  assert.ok(seedCliRefusal(undefined).includes('"unset"'));
});

test('demoController still exposes the same shared predicate', () => {
  assert.strictEqual(isDemoResetAllowed('demo'), true);
  assert.strictEqual(isDemoResetAllowed('production'), false);
});

// Runs the real CLI. MONGO_URI points at a closed local port, so even a
// broken guard could never reach a real database; the assertions check the
// refusal message, which is printed only by the pre-connect guard.
for (const mode of ['production', 'development', '']) {
  test(`seed CLI refuses with APP_MODE="${mode}" and exits non-zero without connecting`, () => {
    const r = spawnSync(process.execPath, [SEED], {
      env: { ...process.env, APP_MODE: mode, MONGO_URI: 'mongodb://127.0.0.1:1/seed-guard-test', NODE_ENV: '' },
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /Refusing to seed/);
    assert.match(r.stderr, /No database connection was opened/);
    assert.doesNotMatch(r.stdout + r.stderr, /Clearing existing collections|MongoDB connected|MongoDB connection error/);
  });
}
