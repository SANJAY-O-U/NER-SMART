const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIncidentEvidence, buildRoadStatusEvidence } = require('../src/services/accessibilityEvidence');
const { computeAccessibilityFromEvidence } = require('../src/services/accessibilityEngine');

// Mandatory Phase 5 regression: AI output (classification/summary/severity
// hint/confidence/rationale, however extreme) must have ZERO effect on the
// deterministic accessibility engine. buildIncidentEvidence reads only
// incident.severity/roadMatchConfidence/type/status/timestamp — never
// incident.aiResult — and incidentController.js no longer copies
// aiResult.severity onto incident.severity (Phase 5 fix). These tests
// prove both the evidence-builder's isolation and the end-to-end state
// cascade's immunity to AI-only fields.

function baseIncident(overrides = {}) {
  return {
    status: 'AI_ANALYSED',
    type: 'ROAD_DAMAGE',
    severity: 'LOW', // the incident's own, authoritative-for-evidence-purposes severity
    roadMatchConfidence: 'HIGH',
    timestamp: new Date(),
    ...overrides,
  };
}

test('buildIncidentEvidence output is byte-identical whether or not an extreme aiResult is attached, as long as incident.severity is unchanged', () => {
  const withoutAi = baseIncident();
  const withExtremeAi = baseIncident({
    aiResult: {
      classification: 'LANDSLIDE',
      severity: 'HIGH', // AI thinks it's severe...
      confidence: 0.99, // ...and is very confident
      summary: 'Possible major landslide, high confidence.',
      rationale: 'Keyword match on "landslide".',
      source: 'REAL_AI',
    },
  });

  const evidenceWithout = buildIncidentEvidence([withoutAi]);
  const evidenceWith = buildIncidentEvidence([withExtremeAi]);

  assert.deepEqual(evidenceWith, evidenceWithout);
  assert.equal(evidenceWith[0].riskContribution, 20); // LOW -> 20, per incident.severity alone, never AI's HIGH
});

test('an incident whose AI classification says HIGH/0.99-confidence but whose own severity is LOW never reaches HIGH_RISK by itself', () => {
  const incident = baseIncident({
    severity: 'LOW',
    aiResult: { classification: 'FLOOD', severity: 'HIGH', confidence: 0.99, source: 'REAL_AI' },
  });
  const evidence = buildIncidentEvidence([incident]);
  const { state } = computeAccessibilityFromEvidence(evidence);
  assert.notEqual(state, 'HIGH_RISK');
  assert.equal(state, 'OPEN');
});

test('AI saying "low risk" (low severity/confidence) cannot downgrade an authoritative BLOCKED road status', () => {
  const blockedRoadEvidence = buildRoadStatusEvidence({ physicalStatus: 'BLOCKED', lastVerifiedAt: new Date() });
  const incidentEvidence = buildIncidentEvidence([
    baseIncident({
      severity: 'LOW',
      aiResult: { classification: 'OTHER', severity: 'LOW', confidence: 0.05, summary: 'Likely nothing serious.', source: 'REAL_AI' },
    }),
  ]);

  const { state } = computeAccessibilityFromEvidence([...blockedRoadEvidence, ...incidentEvidence]);
  assert.equal(state, 'BLOCKED');
});

test('AI saying "blocked" (via classification/summary text alone) cannot create BLOCKED/RESTRICTED state when no authoritative ROAD_STATUS evidence exists', () => {
  const incidentEvidence = buildIncidentEvidence([
    baseIncident({
      severity: 'HIGH', // even the incident's OWN severity is HIGH here
      aiResult: {
        classification: 'ROAD_DAMAGE',
        severity: 'HIGH',
        confidence: 0.95,
        summary: 'The road appears blocked and impassable.', // AI's text says "blocked" — must not matter
        source: 'REAL_AI',
      },
    }),
  ]);

  const { state } = computeAccessibilityFromEvidence(incidentEvidence);
  // HIGH severity (from the incident's OWN field, not AI) correctly drives HIGH_RISK —
  // but critically never BLOCKED or RESTRICTED, which require explicit ROAD_STATUS evidence.
  assert.equal(state, 'HIGH_RISK');
  assert.notEqual(state, 'BLOCKED');
  assert.notEqual(state, 'RESTRICTED');
});

test('buildIncidentEvidence never reads incident.aiResult at all (structural isolation, not just coincidental output equality)', () => {
  const incident = baseIncident({ aiResult: { severity: 'HIGH', confidence: 1.0, classification: 'LANDSLIDE' } });
  // A Proxy that throws if aiResult is ever accessed — proves the evidence
  // builder truly never touches it, rather than merely producing the same
  // result by chance.
  const guarded = new Proxy(incident, {
    get(target, prop) {
      if (prop === 'aiResult') throw new Error('buildIncidentEvidence must never read incident.aiResult');
      return target[prop];
    },
  });
  assert.doesNotThrow(() => buildIncidentEvidence([guarded]));
});
