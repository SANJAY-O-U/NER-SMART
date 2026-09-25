const test = require('node:test');
const assert = require('node:assert/strict');
const Incident = require('../src/models/Incident');
const { analyzeWithFallback } = require('../src/services/aiService');

// Schema-level tests (no live MongoDB needed, same convention as
// incidentIdempotency.test.js/disasterAlertIdempotency.test.js): verify
// the Phase 5 aiResult fields exist, default safely, and that assigning a
// real analyzeIncident()-shaped result to a document validates cleanly
// without touching the incident's own top-level fields.

test('Incident.aiResult schema includes the Phase 5 provenance fields (rationale/model/generatedAt) alongside the existing ones', () => {
  for (const field of ['classification', 'severity', 'confidence', 'summary', 'rationale', 'model', 'generatedAt', 'source']) {
    assert.ok(Incident.schema.path(`aiResult.${field}`), `expected aiResult.${field} to exist on the schema`);
  }
});

test('aiResult.source is constrained to REAL_AI/DEMO_FALLBACK/null — never an invented label', () => {
  const path = Incident.schema.path('aiResult.source');
  assert.deepEqual(path.enumValues.filter(Boolean).sort(), ['DEMO_FALLBACK', 'REAL_AI']);
});

test('a new Incident document has aiResult fields defaulting to null (backward compatible with pre-Phase-5 documents)', () => {
  const doc = new Incident({ type: 'ROAD_DAMAGE', lat: 26.1, lng: 91.7 });
  assert.equal(doc.aiResult.rationale, null);
  assert.equal(doc.aiResult.model, null);
  assert.equal(doc.aiResult.generatedAt, null);
  assert.equal(doc.aiResult.source, null);
});

test('assigning a real analyzeWithFallback() result to aiResult validates cleanly and leaves the incident\'s own severity untouched', () => {
  const doc = new Incident({ type: 'FLOOD', lat: 26.1, lng: 91.7, severity: 'LOW' });
  doc.aiResult = analyzeWithFallback({ type: 'FLOOD', description: 'severe flood, road washed away' });

  const err = doc.validateSync();
  assert.equal(err, undefined);
  assert.equal(doc.aiResult.severity, 'HIGH'); // AI's own hint, persisted as-is inside aiResult
  assert.equal(doc.severity, 'LOW'); // the incident's own authoritative field, untouched by the assignment
  assert.equal(doc.aiResult.source, 'DEMO_FALLBACK');
  assert.ok(doc.aiResult.rationale);
  assert.ok(doc.aiResult.generatedAt instanceof Date);
});

test('the original driver-submitted fields (type/lat/lng/description) are never touched by attaching an aiResult', () => {
  const doc = new Incident({ type: 'ACCIDENT', lat: 24.8, lng: 92.9, description: 'original driver text' });
  doc.aiResult = analyzeWithFallback({ type: 'ACCIDENT', description: 'original driver text' });
  assert.equal(doc.type, 'ACCIDENT');
  assert.equal(doc.lat, 24.8);
  assert.equal(doc.lng, 92.9);
  assert.equal(doc.description, 'original driver text');
});
