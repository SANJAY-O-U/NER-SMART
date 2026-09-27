const test = require('node:test');
const assert = require('node:assert');
const { computeAccessibilityFromEvidence, computeScore } = require('../src/services/accessibilityEngine');
const { buildIncidentEvidence } = require('../src/services/accessibilityEvidence');

// Phase 8C.7: the explanation must never claim "no significant hazard
// evidence" while evidence is lowering the score, and the reported factor
// contributions must add up to the score. Scoring/state rules unchanged.

const NOW = new Date('2026-09-26T04:00:00Z');

function weatherZero() {
  return { source: 'WEATHERAPI_CURRENT', type: 'RAINFALL_EXPOSURE', status: null, riskContribution: 0, freshness: 'LIVE', confidence: 'HIGH', detail: 'No rainfall exposure' };
}
function mediumIncident() {
  return buildIncidentEvidence(
    [{ type: 'ROAD_DAMAGE', severity: 'MEDIUM', status: 'AI_ANALYSED', roadMatchConfidence: 'HIGH', timestamp: NOW }],
    { now: NOW, classifyIncidentFreshness: () => 'LIVE' }
  );
}
const reconstructed = (r) => Math.max(0, Math.min(100, Math.round(100 + r.factors.reduce((s, f) => s + (f.contribution || 0), 0))));

test('MEDIUM incident lowers the score while the state stays OPEN (scoring model unchanged)', () => {
  const r = computeAccessibilityFromEvidence([weatherZero(), ...mediumIncident()], { now: NOW });
  assert.strictEqual(r.state, 'OPEN');
  assert.strictEqual(r.accessibilityScore, 78); // 100 - 45 * 0.5 = 77.5 -> 78
  assert.strictEqual(r.confidence, 'MEDIUM');
});

test('explanation does not claim "no significant hazard" when an incident lowers the score', () => {
  const r = computeAccessibilityFromEvidence([weatherZero(), ...mediumIncident()], { now: NOW });
  assert.doesNotMatch(r.explanation, /No significant hazard evidence found/);
  assert.match(r.explanation, /MEDIUM severity ROAD_DAMAGE/); // names the evidence category
  assert.match(r.explanation, /below the high-risk threshold/);
  assert.match(r.explanation, /22\.5 points/); // the actual score impact
  assert.match(r.explanation, /Therefore OPEN\./);
});

test('explanation still says "no significant hazard" when nothing lowers the score', () => {
  const r = computeAccessibilityFromEvidence([weatherZero()], { now: NOW });
  assert.strictEqual(r.accessibilityScore, 100);
  assert.match(r.explanation, /No significant hazard evidence found; road is treated as accessible\./);
});

test('factor contributions are the exact score impact and add up to the score', () => {
  const r = computeAccessibilityFromEvidence([weatherZero(), ...mediumIncident()], { now: NOW });
  const incident = r.factors.find((f) => f.source === 'FIELD_INCIDENT');
  assert.strictEqual(incident.contribution, -22.5); // previously -23 (rounded per factor)
  assert.strictEqual(reconstructed(r), r.accessibilityScore);
});

test('score/factor consistency holds across mixed evidence (status + risk items)', () => {
  const cases = [
    [{ source: 'ROAD_STATUS', type: 'OFFICIAL_STATUS', status: 'RESTRICTED', riskContribution: null, freshness: 'LIVE', confidence: 'HIGH', detail: 'official status is RESTRICTED' }],
    [{ source: 'NDMA_SACHET', type: 'DISASTER_ALERT', status: null, riskContribution: 33, freshness: 'LIVE', confidence: 'MEDIUM', detail: 'Flood alert' }, ...mediumIncident()],
    [{ source: 'NDMA_SACHET', type: 'DISASTER_ALERT', status: null, riskContribution: 75, freshness: 'LIVE', confidence: 'MEDIUM', detail: 'Severe flood alert' }, weatherZero()],
  ];
  for (const ev of cases) {
    const r = computeAccessibilityFromEvidence(ev, { now: NOW });
    assert.strictEqual(reconstructed(r), r.accessibilityScore, JSON.stringify(r.factors));
    assert.strictEqual(r.accessibilityScore, computeScore(ev));
  }
});

test('HIGH_RISK / RESTRICTED / BLOCKED behavior and explanations are unchanged', () => {
  const high = computeAccessibilityFromEvidence(
    [{ source: 'NDMA_SACHET', type: 'DISASTER_ALERT', status: null, riskContribution: 75, freshness: 'LIVE', confidence: 'MEDIUM', detail: 'Severe flood alert' }],
    { now: NOW }
  );
  assert.strictEqual(high.state, 'HIGH_RISK');
  assert.match(high.explanation, /Severe flood alert increases exposure\./);

  const restricted = computeAccessibilityFromEvidence(
    [{ source: 'ROAD_STATUS', type: 'OFFICIAL_STATUS', status: 'RESTRICTED', riskContribution: null, freshness: 'LIVE', confidence: 'HIGH', detail: 'official status is RESTRICTED' }, ...mediumIncident()],
    { now: NOW }
  );
  assert.strictEqual(restricted.state, 'RESTRICTED');
  assert.match(restricted.explanation, /official status is RESTRICTED — treated as an official restriction\./);

  const blocked = computeAccessibilityFromEvidence(
    [{ source: 'ROAD_STATUS', type: 'PHYSICAL_STATUS', status: 'BLOCKED', riskContribution: null, freshness: 'LIVE', confidence: 'HIGH', detail: 'physical status is BLOCKED' }],
    { now: NOW }
  );
  assert.strictEqual(blocked.state, 'BLOCKED');
  assert.strictEqual(blocked.accessibilityScore, 10);
  assert.match(blocked.explanation, /treated as authoritative closure evidence\./);
});

test('a stale sub-threshold item is labelled stale, not presented as current', () => {
  const stale = { ...mediumIncident()[0], freshness: 'STALE' };
  const r = computeAccessibilityFromEvidence([weatherZero(), stale], { now: NOW });
  assert.match(r.explanation, /stale/);
  assert.doesNotMatch(r.explanation, /No significant hazard evidence found/);
});

test('authoritative incident severity drives evidence, not the AI result', () => {
  const ev = buildIncidentEvidence(
    [{ type: 'ROAD_DAMAGE', severity: 'MEDIUM', aiResult: { severity: 'HIGH' }, status: 'AI_ANALYSED', roadMatchConfidence: 'HIGH', timestamp: NOW }],
    { now: NOW, classifyIncidentFreshness: () => 'LIVE' }
  );
  assert.strictEqual(ev[0].riskContribution, 45); // MEDIUM, not the AI's HIGH (75)
  assert.match(ev[0].detail, /^MEDIUM severity/);
});
