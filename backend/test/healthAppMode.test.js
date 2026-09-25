const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');

// Regression (Phase 7A.1): /api/health must report the effective mode the
// safety guards actually use — an unset APP_MODE is NOT demo.
async function getHealth(appMode) {
  const saved = process.env.APP_MODE;
  if (appMode === undefined) delete process.env.APP_MODE;
  else process.env.APP_MODE = appMode;

  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    assert.strictEqual(res.status, 200);
    return (await res.json()).data;
  } finally {
    server.close();
    if (saved === undefined) delete process.env.APP_MODE;
    else process.env.APP_MODE = saved;
  }
}

test('unset APP_MODE is reported as unset, not demo', async () => {
  const data = await getHealth(undefined);
  assert.strictEqual(data.appMode, 'unset');
  assert.strictEqual(data.demoMode, false);
});

test('APP_MODE=demo is reported as demo with demo features enabled', async () => {
  const data = await getHealth('demo');
  assert.strictEqual(data.appMode, 'demo');
  assert.strictEqual(data.demoMode, true);
});

test('APP_MODE=production is reported with demo features disabled', async () => {
  const data = await getHealth('production');
  assert.strictEqual(data.appMode, 'production');
  assert.strictEqual(data.demoMode, false);
});

test('a non-exact value like "Demo" does not enable demo features', async () => {
  const data = await getHealth('Demo');
  assert.strictEqual(data.appMode, 'Demo');
  assert.strictEqual(data.demoMode, false);
});

test('health response keeps its existing fields', async () => {
  const data = await getHealth('production');
  assert.strictEqual(data.status, 'ok');
  assert.strictEqual(data.service, 'ner-smart-backend');
});
