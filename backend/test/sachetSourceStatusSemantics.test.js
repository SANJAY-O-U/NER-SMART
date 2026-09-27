const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const app = require('../src/app');
const DisasterAlert = require('../src/models/DisasterAlert');
const Road = require('../src/models/Road');
const { registerSource } = require('../src/services/dataSourceRegistry');
const { buildDisasterEvidence } = require('../src/services/accessibilityEvidence');
const { computeDisasterRiskContribution } = require('../src/services/disasterRiskAdapter');

// Phase 8C.7: a stored SACHET record's `sourceStatus` is RETRIEVAL-TIME
// provenance ("the fetch that wrote this record succeeded"), never the
// feed's CURRENT availability — which lives only in the data source
// registry. The API must expose both, distinctly.

const NOW = new Date();
const future = new Date(NOW.getTime() + 6 * 3600e3);
const past = new Date(NOW.getTime() - 6 * 3600e3);

const storedRecord = {
  _id: 'a1',
  identifier: 'IN-1',
  event: 'Flood',
  severity: 'Moderate',
  lifecycleStatus: 'ACTIVE',
  sourceStatus: 'LIVE', // written when fetched hours ago
  retrievedAt: new Date(NOW.getTime() - 5 * 3600e3),
  expires: future,
  sent: new Date(NOW.getTime() - 5 * 3600e3),
};

async function get(pathname) {
  const server = app.listen(0);
  try {
    await new Promise((r) => server.once('listening', r));
    const res = await fetch(`http://127.0.0.1:${server.address().port}${pathname}`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

function stubFind(docs) {
  const orig = DisasterAlert.find;
  DisasterAlert.find = () => ({ sort: () => ({ select: async () => docs }) });
  return () => { DisasterAlert.find = orig; };
}

test('GET /api/sachet/alerts reports CURRENT feed status separately from record provenance', async () => {
  registerSource('NDMA_SACHET', { status: 'UNAVAILABLE', source: 'test', error: 'timeout' });
  const restore = stubFind([storedRecord]);
  try {
    const { status, body } = await get('/api/sachet/alerts');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.data)); // existing contract unchanged
    assert.strictEqual(body.data[0].sourceStatus, 'LIVE'); // stored provenance untouched
    assert.strictEqual(body.feed.status, 'UNAVAILABLE'); // current availability
    assert.strictEqual(body.feed.error, 'timeout');
    assert.match(body.feed.note, /retrieval-time provenance/);
  } finally { restore(); }
});

test('feed status follows the registry, not the records (LIVE feed, same records)', async () => {
  registerSource('NDMA_SACHET', { status: 'LIVE', source: 'test' });
  const restore = stubFind([storedRecord]);
  try {
    const { body } = await get('/api/sachet/alerts');
    assert.strictEqual(body.feed.status, 'LIVE');
    assert.strictEqual(body.feed.error, null);
  } finally { restore(); }
});

test('GET /api/sachet/road/:id includes current feed status alongside the existing fields', async () => {
  registerSource('NDMA_SACHET', { status: 'UNAVAILABLE', source: 'test', error: 'timeout' });
  const origRoad = Road.findById;
  Road.findById = async () => ({ _id: 'r1', id: 'r1', district: null, districtAssignmentMethod: null });
  const restore = stubFind([]);
  try {
    const { status, body } = await get('/api/sachet/road/000000000000000000000001');
    assert.strictEqual(status, 200);
    assert.strictEqual(body.data.activeAlertCount, 0);
    assert.deepStrictEqual(body.data.alerts, []);
    assert.strictEqual(body.data.feed.status, 'UNAVAILABLE');
  } finally { Road.findById = origRoad; restore(); }
});

test('accessibility evidence ignores record sourceStatus; lifecycle + expiry decide', () => {
  const liveButExpired = { ...storedRecord, lifecycleStatus: 'EXPIRED', expires: past, sourceStatus: 'LIVE' };
  const activeFetchedWhenFeedUnavailable = { ...storedRecord, sourceStatus: 'UNAVAILABLE' };
  assert.deepStrictEqual(buildDisasterEvidence([liveButExpired], computeDisasterRiskContribution, NOW), []);
  const ev = buildDisasterEvidence([activeFetchedWhenFeedUnavailable], computeDisasterRiskContribution, NOW);
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].freshness, 'LIVE'); // from lifecycleStatus, not sourceStatus
});

test('no backend code path reads a stored SACHET sourceStatus as feed availability', () => {
  // Only persistAlert may touch DisasterAlert.sourceStatus, and only to WRITE it.
  const files = ['controllers/sachetController.js', 'services/sachetService.js', 'services/sachetValidation.js',
    'services/sachetRoadAssociation.js', 'services/disasterRiskAdapter.js', 'services/disasterLifecycleService.js',
    'services/accessibilityService.js', 'controllers/dataSourceController.js'];
  for (const f of files) {
    const p = path.join(__dirname, '..', 'src', f);
    if (!fs.existsSync(p)) continue;
    const code = fs.readFileSync(p, 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n');
    // A READ is property access (`alert.sourceStatus`, `a['sourceStatus']`)
    // or destructuring (`{ sourceStatus } = ...`). Writes (`sourceStatus: 'LIVE'`)
    // and documentation strings are fine.
    const reads = code.match(/\.sourceStatus\b|\[['"]sourceStatus['"]\]|\{[^}\n]*\bsourceStatus\b[^}\n]*\}\s*=/g) || [];
    assert.deepStrictEqual(reads, [], `${f} reads a stored sourceStatus`);
    const writes = code.match(/\bsourceStatus:\s*[^\n,]+/g) || [];
    for (const w of writes) assert.match(w, /^sourceStatus: 'LIVE'$/, `${f}: unexpected sourceStatus write ${w}`);
  }
  const evidenceSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'accessibilityEvidence.js'), 'utf8');
  const start = evidenceSrc.indexOf('function buildDisasterEvidence');
  const disasterFn = evidenceSrc.slice(start, evidenceSrc.indexOf('\n/**', start)); // function body only
  assert.doesNotMatch(disasterFn, /sourceStatus/);
});
