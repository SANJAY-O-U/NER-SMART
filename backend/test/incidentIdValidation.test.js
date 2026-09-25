const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');
const Incident = require('../src/models/Incident');

// Regression (Phase 7B.1): GET /api/incidents/:id with a malformed id
// returned 500 (Mongoose CastError) while PATCH returned 400. Both now use
// validateObjectIdParam. Incident.findById is stubbed so no DB is needed.

async function get(path, findByIdImpl) {
  const orig = Incident.findById;
  let calls = 0;
  Incident.findById = async (...args) => { calls += 1; return findByIdImpl(...args); };
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: res.status, body: await res.json(), calls };
  } finally {
    server.close();
    Incident.findById = orig;
  }
}

test('invalid id -> 400 with the same error as PATCH, never queries the DB', async () => {
  const r = await get('/api/incidents/not-an-id', () => { throw new Error('should not be called'); });
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual(r.body, { success: false, error: 'id must be a valid id' });
  assert.strictEqual(r.calls, 0);
});

test('valid id that exists -> 200 with the incident, unchanged shape', async () => {
  const id = '0123456789abcdef01234567';
  const doc = { _id: id, type: 'LANDSLIDE', severity: 'HIGH' };
  const r = await get(`/api/incidents/${id}`, (q) => (q === id ? doc : null));
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, { success: true, data: doc });
  assert.strictEqual(r.calls, 1);
});

test('valid id that does not exist -> 404 unchanged', async () => {
  const r = await get('/api/incidents/000000000000000000000000', () => null);
  assert.strictEqual(r.status, 404);
  assert.deepStrictEqual(r.body, { success: false, error: 'Incident not found' });
});
