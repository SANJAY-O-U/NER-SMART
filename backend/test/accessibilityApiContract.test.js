const test = require('node:test');
const assert = require('node:assert/strict');
const { computeAccessibilityFromEvidence } = require('../src/services/accessibilityEngine');

// Phase 6G: the accessibility contract (what GET /api/roads/:roadId/accessibility
// and GET /api/incidents/:id/impact both ultimately return, via
// accessibilityService.computeAccessibilityForRoad spreading this exact
// shape — see accessibilityService.js) must expose enough information to
// explain state/score/confidence/evidence/freshness/provenance/reason, per
// the mission's API-contract requirement. This locks the shape down as a
// regression guard — no new fields are introduced, this only proves the
// EXISTING fields already satisfy the requirement, and catches any future
// accidental removal.

function richEvidence(now) {
  return [
    { source: 'ROAD_STATUS', type: 'PHYSICAL_STATUS', status: 'OPEN', riskContribution: null, timestamp: now, freshness: 'CACHED', confidence: 'HIGH', associationMethod: null, detail: 'physical status is OPEN' },
    { source: 'WEATHERAPI_CURRENT', type: 'RAINFALL_EXPOSURE', status: null, riskContribution: 35, timestamp: now, freshness: 'LIVE', confidence: 'HIGH', associationMethod: null, detail: 'Rainfall exposure from nearest weather source (4km away)' },
    { source: 'NDMA_SACHET', type: 'FLOOD', status: null, riskContribution: 40, timestamp: now, freshness: 'LIVE', confidence: 'MEDIUM', associationMethod: 'LGD_DISTRICT_MATCH', detail: 'Severe severity Flood (LGD_DISTRICT_MATCH)' },
  ];
}

test('the accessibility contract exposes state, score, confidence, evidence, and a human-readable reason at the top level', () => {
  const now = new Date();
  const result = computeAccessibilityFromEvidence(richEvidence(now), { now });

  // state
  assert.equal(typeof result.state, 'string');
  assert.ok(['OPEN', 'RESTRICTED', 'HIGH_RISK', 'BLOCKED', 'UNKNOWN'].includes(result.state));
  // score
  assert.equal(typeof result.accessibilityScore, 'number');
  assert.ok(result.accessibilityScore >= 0 && result.accessibilityScore <= 100);
  // confidence
  assert.ok(['HIGH', 'MEDIUM', 'LOW', null].includes(result.confidence));
  // reason (human-readable explanation, traceable to actual evidence, never an LLM)
  assert.equal(typeof result.explanation, 'string');
  assert.ok(result.explanation.length > 0);
  // provenance timestamp for the computation itself
  assert.ok(result.calculatedAt instanceof Date);
});

test('the accessibility contract exposes per-evidence provenance (source, association method) via `evidence[]`', () => {
  const now = new Date();
  const result = computeAccessibilityFromEvidence(richEvidence(now), { now });

  assert.ok(Array.isArray(result.evidence));
  assert.ok(result.evidence.length >= 3);
  for (const item of result.evidence) {
    assert.ok('source' in item);
    assert.ok('type' in item);
    assert.ok('timestamp' in item);
    assert.ok('associationMethod' in item); // provenance: HOW this evidence was linked to the road
  }
  const sachetItem = result.evidence.find((e) => e.source === 'NDMA_SACHET');
  assert.equal(sachetItem.associationMethod, 'LGD_DISTRICT_MATCH');
});

test('the accessibility contract exposes per-factor freshness and confidence via `factors[]`', () => {
  const now = new Date();
  const result = computeAccessibilityFromEvidence(richEvidence(now), { now });

  assert.ok(Array.isArray(result.factors));
  assert.ok(result.factors.length >= 2); // status evidence alone isn't scored, so fewer factors than evidence items
  for (const factor of result.factors) {
    assert.ok('name' in factor);
    assert.ok('source' in factor);
    assert.ok('freshness' in factor); // freshness: is this factor still current?
    assert.ok('confidence' in factor);
    assert.ok('contribution' in factor); // signed score impact, explaining WHY the score is what it is
  }
});

test('an UNKNOWN-state contract (no evidence) still returns the full, honest shape — never a partial/undefined response', () => {
  const result = computeAccessibilityFromEvidence([], { now: new Date() });
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.accessibilityScore, null); // honestly null, never fabricated as 0 or 100
  assert.equal(result.confidence, null);
  assert.deepEqual(result.factors, []);
  assert.deepEqual(result.evidence, []);
  assert.match(result.explanation, /UNKNOWN/);
});
