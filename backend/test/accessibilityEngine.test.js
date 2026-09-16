const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeAccessibilityFromEvidence,
  determineState,
  computeScore,
  computeConfidence,
} = require('../src/services/accessibilityEngine');

const NOW = new Date('2026-09-15T12:00:00Z');

function statusEvidence(status, overrides = {}) {
  return {
    source: 'ROAD_STATUS',
    type: overrides.type || 'FIELD_STATUS',
    status,
    riskContribution: null,
    freshness: 'CACHED',
    confidence: 'HIGH',
    detail: `status is ${status}`,
    timestamp: NOW,
    associationMethod: null,
    ...overrides,
  };
}

function riskEvidence(source, riskContribution, overrides = {}) {
  return {
    source,
    type: overrides.type || 'RISK_FACTOR',
    status: null,
    riskContribution,
    freshness: 'LIVE',
    confidence: 'MEDIUM',
    detail: `${source} risk ${riskContribution}`,
    timestamp: NOW,
    associationMethod: null,
    ...overrides,
  };
}

// 1. no evidence -> UNKNOWN
test('no evidence produces UNKNOWN state and null score/confidence', () => {
  const result = computeAccessibilityFromEvidence([], { now: NOW });
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.accessibilityScore, null);
  assert.equal(result.confidence, null);
});

// 2. clean road -> OPEN
test('a single OPEN status evidence produces OPEN state with full score', () => {
  const result = computeAccessibilityFromEvidence([statusEvidence('OPEN')], { now: NOW });
  assert.equal(result.state, 'OPEN');
  assert.equal(result.accessibilityScore, 100);
});

// 3/4. active disaster alert increases risk but is NOT BLOCKED
test('an active disaster alert alone increases risk without producing BLOCKED', () => {
  const result = computeAccessibilityFromEvidence([riskEvidence('NDMA_SACHET', 75)], { now: NOW });
  assert.notEqual(result.state, 'BLOCKED');
  assert.equal(result.state, 'HIGH_RISK');
  assert.ok(result.accessibilityScore < 100);
});

test('weather alone can never produce BLOCKED, even at maximum risk', () => {
  const result = computeAccessibilityFromEvidence([riskEvidence('IMD_WEATHER', 100)], { now: NOW });
  assert.notEqual(result.state, 'BLOCKED');
});

test('a GPS/field incident report alone can never produce BLOCKED', () => {
  const result = computeAccessibilityFromEvidence([riskEvidence('FIELD_INCIDENT', 90)], { now: NOW });
  assert.notEqual(result.state, 'BLOCKED');
});

// 5. explicit field BLOCKED -> BLOCKED
test('explicit fieldStatus BLOCKED produces BLOCKED state', () => {
  const result = computeAccessibilityFromEvidence([statusEvidence('BLOCKED', { type: 'FIELD_STATUS' })], { now: NOW });
  assert.equal(result.state, 'BLOCKED');
});

// 6. explicit official closure -> BLOCKED
test('explicit officialStatus BLOCKED produces BLOCKED state', () => {
  const result = computeAccessibilityFromEvidence([statusEvidence('BLOCKED', { type: 'OFFICIAL_STATUS' })], { now: NOW });
  assert.equal(result.state, 'BLOCKED');
});

// 7. official restriction -> RESTRICTED
test('explicit RESTRICTED status produces RESTRICTED state, outranking a lower disaster risk', () => {
  const result = computeAccessibilityFromEvidence(
    [statusEvidence('RESTRICTED', { type: 'OFFICIAL_STATUS' }), riskEvidence('NDMA_SACHET', 30)],
    { now: NOW }
  );
  assert.equal(result.state, 'RESTRICTED');
});

test('BLOCKED outranks RESTRICTED when both are present', () => {
  const result = computeAccessibilityFromEvidence(
    [statusEvidence('RESTRICTED', { type: 'OFFICIAL_STATUS' }), statusEvidence('BLOCKED', { type: 'FIELD_STATUS' })],
    { now: NOW }
  );
  assert.equal(result.state, 'BLOCKED');
});

// 8. stale evidence loses influence
test('stale evidence does not influence state (excluded from the active cascade)', () => {
  const stale = riskEvidence('NDMA_SACHET', 90, { freshness: 'STALE' });
  const result = computeAccessibilityFromEvidence([stale], { now: NOW });
  assert.notEqual(result.state, 'HIGH_RISK');
  // Score still reflects it exists as evidence (not deleted), just not driving state.
  assert.equal(computeScore([stale]) < 100, true);
});

// 9. expired SACHET alert does not behave as active
test('a zero-score (expired) disaster evidence item does not appear as meaningful', () => {
  // accessibilityEvidence.js filters score===0 out entirely before this
  // point, but the engine itself should also treat riskContribution=0
  // as non-elevating.
  const expired = riskEvidence('NDMA_SACHET', 0);
  const result = computeAccessibilityFromEvidence([expired], { now: NOW });
  assert.notEqual(result.state, 'HIGH_RISK');
});

// 10. field PASSABLE + SACHET flood -> conflict handled, not hidden
test('conflicting evidence (OPEN field status vs high disaster risk) produces HIGH_RISK with reduced confidence and a visible explanation of both', () => {
  const result = computeAccessibilityFromEvidence(
    [riskEvidence('NDMA_SACHET', 75, { detail: 'Severe flood alert' }), statusEvidence('OPEN', { detail: 'field status is OPEN' })],
    { now: NOW }
  );
  assert.equal(result.state, 'HIGH_RISK');
  assert.match(result.explanation, /flood/i);
  assert.match(result.explanation, /OPEN|field/i);
});

// 11. multiple agreeing sources increase confidence
test('three independent agreeing sources produce HIGH confidence', () => {
  const result = computeAccessibilityFromEvidence(
    [
      riskEvidence('NDMA_SACHET', 70),
      riskEvidence('IMD_WEATHER', 65),
      riskEvidence('FIELD_INCIDENT', 60, { confidence: 'HIGH' }),
    ],
    { now: NOW }
  );
  assert.equal(result.confidence, 'HIGH');
});

test('a single source produces LOW confidence', () => {
  const result = computeAccessibilityFromEvidence([riskEvidence('NDMA_SACHET', 70)], { now: NOW });
  assert.equal(result.confidence, 'LOW');
});

// 12. conflicting sources reduce confidence
test('conflicting sources reduce confidence relative to the same sources agreeing', () => {
  const agreeing = computeAccessibilityFromEvidence(
    [riskEvidence('NDMA_SACHET', 75), riskEvidence('FIELD_INCIDENT', 70)],
    { now: NOW }
  ).confidence;
  const conflicting = computeAccessibilityFromEvidence(
    [riskEvidence('NDMA_SACHET', 75), statusEvidence('OPEN')],
    { now: NOW }
  ).confidence;
  const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  assert.ok(rank[conflicting] <= rank[agreeing]);
});

// 13. low road-match confidence reduces evidence confidence
test('a LOW-confidence field incident (poor GPS/road match) pulls overall confidence down', () => {
  const highConf = computeAccessibilityFromEvidence(
    [riskEvidence('FIELD_INCIDENT', 70, { confidence: 'HIGH' }), riskEvidence('NDMA_SACHET', 65)],
    { now: NOW }
  ).confidence;
  const lowConf = computeAccessibilityFromEvidence(
    [riskEvidence('FIELD_INCIDENT', 70, { confidence: 'LOW' }), riskEvidence('NDMA_SACHET', 65)],
    { now: NOW }
  ).confidence;
  const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  assert.ok(rank[lowConf] < rank[highConf]);
});

// 14. unavailable IMD does not create fake weather risk
test('no weather evidence item means no weather contribution at all (never fabricated)', () => {
  const result = computeAccessibilityFromEvidence([statusEvidence('OPEN')], { now: NOW });
  const weatherFactor = result.factors.find((f) => f.source === 'IMD_WEATHER');
  assert.equal(weatherFactor, undefined);
});

// 15. missing fields remain unknown
test('a status evidence item with status UNKNOWN is not counted as meaningful', () => {
  const result = computeAccessibilityFromEvidence([statusEvidence('UNKNOWN')], { now: NOW });
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.accessibilityScore, null);
});

// 16. score remains 0-100
test('score is always clamped within 0-100 even with many stacked risk factors', () => {
  const many = Array.from({ length: 10 }, () => riskEvidence('NDMA_SACHET', 90));
  const result = computeAccessibilityFromEvidence(many, { now: NOW });
  assert.ok(result.accessibilityScore >= 0 && result.accessibilityScore <= 100);
});

// 17. score is deterministic
test('identical evidence always produces identical output', () => {
  const evidence = [riskEvidence('NDMA_SACHET', 55), statusEvidence('OPEN')];
  const a = computeAccessibilityFromEvidence(evidence, { now: NOW });
  const b = computeAccessibilityFromEvidence(evidence, { now: NOW });
  assert.equal(a.accessibilityScore, b.accessibilityScore);
  assert.equal(a.state, b.state);
  assert.equal(a.confidence, b.confidence);
  assert.equal(a.explanation, b.explanation);
});

// 18. explanations match actual factors
test('explanation names the actual evidence source/detail that drove the decision', () => {
  const result = computeAccessibilityFromEvidence(
    [statusEvidence('BLOCKED', { type: 'OFFICIAL_STATUS', detail: 'official status is BLOCKED' })],
    { now: NOW }
  );
  assert.match(result.explanation, /official status is BLOCKED/);
  assert.match(result.explanation, /BLOCKED/);
});

// 19. provenance is preserved
test('every evidence item in the output retains source, type, and timestamp', () => {
  const result = computeAccessibilityFromEvidence(
    [riskEvidence('NDMA_SACHET', 60, { type: 'FLOOD_ALERT', associationMethod: 'LGD_DISTRICT_MATCH' })],
    { now: NOW }
  );
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].source, 'NDMA_SACHET');
  assert.equal(result.evidence[0].type, 'FLOOD_ALERT');
  assert.equal(result.evidence[0].associationMethod, 'LGD_DISTRICT_MATCH');
  assert.deepEqual(result.evidence[0].timestamp, NOW);
});

test('calculatedAt is always present in the output', () => {
  const result = computeAccessibilityFromEvidence([statusEvidence('OPEN')], { now: NOW });
  assert.deepEqual(result.calculatedAt, NOW);
});

test('determineState/computeScore/computeConfidence are independently callable and pure', () => {
  const evidence = [statusEvidence('RESTRICTED')];
  assert.equal(determineState(evidence), 'RESTRICTED');
  assert.equal(computeScore(evidence), 70);
  assert.equal(computeConfidence(evidence), 'LOW');
});
