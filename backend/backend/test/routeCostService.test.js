const test = require('node:test');
const assert = require('node:assert/strict');
const { computeEdgeCost, CARGO_WEIGHTS } = require('../src/services/routeCostService');

function edge(lengthKm = 10) {
  return { lengthKm, roadName: 'Test Road', roadId: 'r1' };
}
function accessibility(state, score = null, confidence = null) {
  return { state, accessibilityScore: score, confidence };
}

test('a BLOCKED road is excluded (cost=Infinity, blocked=true) regardless of cargo priority', () => {
  for (const priority of ['NORMAL', 'IMPORTANT', 'EMERGENCY']) {
    const result = computeEdgeCost(edge(), accessibility('BLOCKED'), priority, 'BALANCED');
    assert.equal(result.blocked, true);
    assert.equal(result.cost, Infinity);
  }
});

test('BLOCKED is never overridden by EMERGENCY priority — the mission\'s explicit requirement', () => {
  const result = computeEdgeCost(edge(), accessibility('BLOCKED'), 'EMERGENCY', 'BALANCED');
  assert.equal(result.blocked, true);
});

test('a RESTRICTED road adds a penalty but is not blocked', () => {
  const result = computeEdgeCost(edge(), accessibility('RESTRICTED', 60), 'NORMAL', 'BALANCED');
  assert.equal(result.blocked, false);
  assert.ok(result.cost > edge().lengthKm);
});

test('a HIGH_RISK road adds a larger penalty than RESTRICTED, all else equal', () => {
  const restricted = computeEdgeCost(edge(), accessibility('RESTRICTED', 60), 'NORMAL', 'BALANCED');
  const highRisk = computeEdgeCost(edge(), accessibility('HIGH_RISK', 60), 'NORMAL', 'BALANCED');
  assert.ok(highRisk.cost > restricted.cost);
});

test('an OPEN road with full accessibility score adds no penalty', () => {
  const result = computeEdgeCost(edge(), accessibility('OPEN', 100), 'NORMAL', 'BALANCED');
  assert.equal(result.cost, edge().lengthKm);
});

test('UNKNOWN accessibility adds a moderate, non-zero, non-blocking penalty', () => {
  const result = computeEdgeCost(edge(), accessibility('UNKNOWN', null), 'NORMAL', 'BALANCED');
  assert.equal(result.blocked, false);
  assert.ok(result.cost > edge().lengthKm);
});

test('EMERGENCY cargo penalizes risk more heavily than NORMAL cargo (stronger safety preference)', () => {
  const normal = computeEdgeCost(edge(), accessibility('HIGH_RISK', 40), 'NORMAL', 'BALANCED');
  const emergency = computeEdgeCost(edge(), accessibility('HIGH_RISK', 40), 'EMERGENCY', 'BALANCED');
  assert.ok(emergency.cost > normal.cost);
});

test('IMPORTANT cargo sits between NORMAL and EMERGENCY in risk aversion', () => {
  const normal = computeEdgeCost(edge(), accessibility('HIGH_RISK', 40), 'NORMAL', 'BALANCED');
  const important = computeEdgeCost(edge(), accessibility('HIGH_RISK', 40), 'IMPORTANT', 'BALANCED');
  const emergency = computeEdgeCost(edge(), accessibility('HIGH_RISK', 40), 'EMERGENCY', 'BALANCED');
  assert.ok(normal.cost < important.cost && important.cost < emergency.cost);
});

test('EMERGENCY cargo is more tolerant of RESTRICTED roads than of HIGH_RISK roads (lower restrictionWeight)', () => {
  assert.ok(CARGO_WEIGHTS.EMERGENCY.restrictionWeight < CARGO_WEIGHTS.EMERGENCY.riskWeight);
});

test('EMERGENCY cargo prefers KNOWN roads over UNKNOWN more strongly than NORMAL does', () => {
  const normalUnknown = computeEdgeCost(edge(), accessibility('UNKNOWN'), 'NORMAL', 'BALANCED');
  const emergencyUnknown = computeEdgeCost(edge(), accessibility('UNKNOWN'), 'EMERGENCY', 'BALANCED');
  assert.ok(emergencyUnknown.cost > normalUnknown.cost);
});

test('SHORTEST mode ignores risk penalties entirely (distance only) but still excludes BLOCKED', () => {
  const openResult = computeEdgeCost(edge(), accessibility('HIGH_RISK', 10), 'NORMAL', 'SHORTEST');
  assert.equal(openResult.cost, edge().lengthKm); // no risk penalty in SHORTEST mode
  const blockedResult = computeEdgeCost(edge(), accessibility('BLOCKED'), 'NORMAL', 'SHORTEST');
  assert.equal(blockedResult.blocked, true); // still excluded even in SHORTEST mode
});

test('a lower accessibilityScore produces a higher cost, all else equal', () => {
  const highScore = computeEdgeCost(edge(), accessibility('OPEN', 90), 'NORMAL', 'BALANCED');
  const lowScore = computeEdgeCost(edge(), accessibility('OPEN', 20), 'NORMAL', 'BALANCED');
  assert.ok(lowScore.cost > highScore.cost);
});

test('null accessibility (no data at all) is treated the same as UNKNOWN, not as OPEN', () => {
  const nullResult = computeEdgeCost(edge(), null, 'NORMAL', 'BALANCED');
  const unknownResult = computeEdgeCost(edge(), accessibility('UNKNOWN'), 'NORMAL', 'BALANCED');
  assert.equal(nullResult.cost, unknownResult.cost);
  assert.ok(nullResult.cost > edge().lengthKm);
});
