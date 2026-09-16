const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDisasterRiskContribution } = require('../src/services/disasterRiskAdapter');

const NOW = new Date('2026-09-15T12:00:00Z');

function alert(overrides = {}) {
  return {
    severity: 'Moderate',
    urgency: 'Expected',
    certainty: 'Likely',
    event: 'Thunderstorm',
    expires: new Date('2026-09-15T15:00:00Z'),
    ...overrides,
  };
}

test('returns null score with an explanatory entry when alert is null', () => {
  const { score, explanation } = computeDisasterRiskContribution(null, NOW);
  assert.equal(score, null);
  assert.equal(explanation[0].factor, 'disaster_alert');
});

test('returns 0 for an expired alert regardless of severity', () => {
  const { score, explanation } = computeDisasterRiskContribution(
    alert({ severity: 'Extreme', expires: new Date('2026-09-15T10:00:00Z') }),
    NOW
  );
  assert.equal(score, 0);
  assert.equal(explanation[0].factor, 'expiry');
});

test('Extreme/Immediate/Observed produces the maximum score', () => {
  const { score } = computeDisasterRiskContribution(
    alert({ severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' }),
    NOW
  );
  assert.equal(score, 100);
});

test('Minor/Past/Unlikely produces a low score', () => {
  const { score } = computeDisasterRiskContribution(
    alert({ severity: 'Minor', urgency: 'Past', certainty: 'Unlikely' }),
    NOW
  );
  assert.ok(score < 25, `expected a low score, got ${score}`);
});

test('unknown/missing severity falls back to the Unknown weight rather than throwing', () => {
  const { score } = computeDisasterRiskContribution(
    alert({ severity: 'SomethingNotInCAP', urgency: undefined, certainty: null }),
    NOW
  );
  assert.equal(typeof score, 'number');
  assert.ok(score >= 0 && score <= 100);
});

test('explanation includes one entry per factor with source attribution', () => {
  const { explanation } = computeDisasterRiskContribution(alert(), NOW);
  const factors = explanation.map((e) => e.factor);
  assert.ok(factors.includes('severity'));
  assert.ok(factors.includes('urgency'));
  assert.ok(factors.includes('certainty'));
  assert.ok(factors.includes('event_type'));
  explanation.forEach((e) => {
    if (e.factor !== 'expiry' && e.factor !== 'disaster_alert') {
      assert.equal(e.source, 'NDMA_SACHET');
    }
  });
});

test('event_type is informational only (null contribution) to avoid double-counting with severity', () => {
  const { explanation } = computeDisasterRiskContribution(alert(), NOW);
  const eventFactor = explanation.find((e) => e.factor === 'event_type');
  assert.equal(eventFactor.contribution, null);
});

test('higher severity always yields a higher score, all else equal', () => {
  const minor = computeDisasterRiskContribution(alert({ severity: 'Minor' }), NOW).score;
  const moderate = computeDisasterRiskContribution(alert({ severity: 'Moderate' }), NOW).score;
  const severe = computeDisasterRiskContribution(alert({ severity: 'Severe' }), NOW).score;
  const extreme = computeDisasterRiskContribution(alert({ severity: 'Extreme' }), NOW).score;
  assert.ok(minor < moderate && moderate < severe && severe < extreme);
});
