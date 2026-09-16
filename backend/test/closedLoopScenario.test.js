const test = require('node:test');
const assert = require('node:assert/strict');
const { computeAccessibilityFromEvidence } = require('../src/services/accessibilityEngine');
const { buildIncidentEvidence, buildRoadStatusEvidence } = require('../src/services/accessibilityEvidence');
const { classifyIncidentFreshness } = require('../src/services/incidentFreshnessService');
const { shouldTriggerAlert } = require('../src/services/alertTriggerService');

/**
 * Phase 6K — closed-loop scenario test.
 *
 * Exercises the REAL pure decision chain
 * (accessibilityEvidence -> accessibilityEngine -> alertTriggerService)
 * exactly as incidentController.js composes them, using a fabricated
 * road/incident fixture. Per the mission's explicit rule, synthetic
 * data is permitted INSIDE an isolated unit-test fixture like this one
 * — it is never written to production road data.
 *
 * What this test CANNOT cover (documented, not silently skipped): the
 * actual MongoDB reads/writes, the real geospatial road-association
 * query, and the real Alert.create()/dedup query — those require a live
 * database this sandbox cannot reach (same limitation noted in every
 * previous phase's report).
 */

const NOW = new Date('2026-09-16T12:00:00Z');

test('1-7: baseline road (OPEN) -> field incident -> accessibility degrades -> alert would trigger, with FIELD_INCIDENT evidence visible', () => {
  // 1. Baseline road, no explicit status set (UNKNOWN evidence-wise) but
  //    treat "OPEN" as the pre-incident state via an explicit fieldStatus,
  //    matching how a verified/known-clear road would look in practice.
  const road = { physicalStatus: 'OPEN', officialStatus: 'UNKNOWN', fieldStatus: 'UNKNOWN', lastVerifiedAt: NOW };

  // 2. Verify baseline accessibility.
  const beforeEvidence = [...buildRoadStatusEvidence(road)];
  const before = computeAccessibilityFromEvidence(beforeEvidence, { now: NOW });
  assert.equal(before.state, 'OPEN');
  assert.equal(before.accessibilityScore, 100);

  // 3. Create field incident (HIGH severity, HIGH road-match confidence — a
  //    real GPS-based field report).
  const incident = {
    type: 'LANDSLIDE',
    severity: 'HIGH',
    status: 'AI_ANALYSED', // not RESOLVED
    roadMatchConfidence: 'HIGH',
    timestamp: NOW, // fresh
  };

  // 4. Association is assumed already done (roadMatchConfidence: HIGH set
  //    above) — this is what incidentRoadAssociation.js would produce.

  // 5. Recompute accessibility WITH the new incident's evidence.
  const afterEvidence = [
    ...buildRoadStatusEvidence(road),
    ...buildIncidentEvidence([incident], { now: NOW, classifyIncidentFreshness }),
  ];
  const after = computeAccessibilityFromEvidence(afterEvidence, { now: NOW });

  // 6. Verify evidence contains the FIELD_INCIDENT source.
  const fieldFactor = after.factors.find((f) => f.source === 'FIELD_INCIDENT');
  assert.ok(fieldFactor, 'expected FIELD_INCIDENT evidence in the recomputed factors');

  // 7. Verify score/state changed according to deterministic rules —
  //    HIGH severity (risk 75) pushes state to HIGH_RISK, never BLOCKED,
  //    since no explicit closure status exists.
  assert.equal(after.state, 'HIGH_RISK');
  assert.notEqual(after.state, 'BLOCKED');
  assert.ok(after.accessibilityScore < before.accessibilityScore);

  // 9. Alert threshold check — this transition SHOULD trigger.
  const decision = shouldTriggerAlert(
    { state: before.state, accessibilityScore: before.accessibilityScore },
    { state: after.state, accessibilityScore: after.accessibilityScore }
  );
  assert.equal(decision.trigger, true);
  assert.equal(decision.direction, 'DEGRADED');
});

test('10-12: resolving the incident removes its evidence and accessibility recovers', () => {
  const road = { physicalStatus: 'OPEN', officialStatus: 'UNKNOWN', fieldStatus: 'UNKNOWN', lastVerifiedAt: NOW };
  const activeIncident = { type: 'LANDSLIDE', severity: 'HIGH', status: 'AI_ANALYSED', roadMatchConfidence: 'HIGH', timestamp: NOW };

  const degradedEvidence = [...buildRoadStatusEvidence(road), ...buildIncidentEvidence([activeIncident], { now: NOW, classifyIncidentFreshness })];
  const degraded = computeAccessibilityFromEvidence(degradedEvidence, { now: NOW });
  assert.equal(degraded.state, 'HIGH_RISK');

  // 10. Resolve incident.
  const resolvedIncident = { ...activeIncident, status: 'RESOLVED', resolvedAt: NOW };

  // 11. Recompute — buildIncidentEvidence excludes RESOLVED incidents entirely.
  const recoveredEvidence = [...buildRoadStatusEvidence(road), ...buildIncidentEvidence([resolvedIncident], { now: NOW, classifyIncidentFreshness })];
  const recovered = computeAccessibilityFromEvidence(recoveredEvidence, { now: NOW });

  // 12. Verify the resolved incident no longer contributes ACTIVE evidence.
  assert.equal(recovered.state, 'OPEN');
  assert.equal(recovered.accessibilityScore, 100);
  const fieldFactor = recovered.factors.find((f) => f.source === 'FIELD_INCIDENT');
  assert.equal(fieldFactor, undefined, 'a RESOLVED incident must not appear as active evidence');

  const decision = shouldTriggerAlert(
    { state: degraded.state, accessibilityScore: degraded.accessibilityScore },
    { state: recovered.state, accessibilityScore: recovered.accessibilityScore }
  );
  assert.equal(decision.trigger, true);
  assert.equal(decision.direction, 'RECOVERED');
});

test('EDGE: a LOW-confidence field incident still contributes evidence, but with LOW confidence, not silently dropped', () => {
  const incident = { type: 'FLOOD', severity: 'HIGH', status: 'REPORTED', roadMatchConfidence: 'LOW', timestamp: NOW };
  const evidence = buildIncidentEvidence([incident], { now: NOW, classifyIncidentFreshness });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].confidence, 'LOW');
});

test('EDGE: a stale (old, unresolved) incident is excluded from the active accessibility cascade', () => {
  const oldTimestamp = new Date(NOW.getTime() - 200 * 60 * 60 * 1000); // ~8 days old
  const staleIncident = { type: 'ROAD_DAMAGE', severity: 'HIGH', status: 'ACTION_REQUIRED', roadMatchConfidence: 'HIGH', timestamp: oldTimestamp };
  const road = { physicalStatus: 'OPEN' };

  const evidence = [...buildRoadStatusEvidence(road), ...buildIncidentEvidence([staleIncident], { now: NOW, classifyIncidentFreshness })];
  const result = computeAccessibilityFromEvidence(evidence, { now: NOW });

  // Stale evidence still appears in the factor list (never deleted /
  // hidden) but does not drive the state to HIGH_RISK.
  assert.equal(result.state, 'OPEN');
  const fieldFactor = result.factors.find((f) => f.source === 'FIELD_INCIDENT');
  assert.ok(fieldFactor);
  assert.equal(fieldFactor.freshness, 'STALE');
});

test('EDGE: a RESOLVED incident never contributes evidence regardless of severity', () => {
  const incident = { type: 'LANDSLIDE', severity: 'HIGH', status: 'RESOLVED', roadMatchConfidence: 'HIGH', timestamp: NOW };
  assert.deepEqual(buildIncidentEvidence([incident], { now: NOW, classifyIncidentFreshness }), []);
});

test('EDGE: an incident with no road match (roadMatchConfidence undefined) still contributes evidence, defaulting to a conservative HIGH-confidence read only when a real match string is absent — never fabricated', () => {
  // No roadMatchConfidence at all (e.g. NONE match) — this incident
  // simply wouldn't be included in a road's Incident.find({roadId})
  // query in the first place (no roadId set), so this models what the
  // evidence WOULD look like if it were (it is not, in the real flow —
  // documented here as a boundary case of the pure function only).
  const incident = { type: 'OTHER', severity: 'MEDIUM', status: 'REPORTED', timestamp: NOW };
  const evidence = buildIncidentEvidence([incident], { now: NOW, classifyIncidentFreshness });
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].confidence, 'HIGH'); // documented default when no match-confidence string is present
});

test('EDGE: repeated recomputation with identical evidence is deterministic', () => {
  const road = { physicalStatus: 'OPEN' };
  const incident = { type: 'FLOOD', severity: 'MEDIUM', status: 'REPORTED', roadMatchConfidence: 'MEDIUM', timestamp: NOW };
  const evidence = [...buildRoadStatusEvidence(road), ...buildIncidentEvidence([incident], { now: NOW, classifyIncidentFreshness })];

  const a = computeAccessibilityFromEvidence(evidence, { now: NOW });
  const b = computeAccessibilityFromEvidence(evidence, { now: NOW });
  assert.equal(a.accessibilityScore, b.accessibilityScore);
  assert.equal(a.state, b.state);
});

test('EDGE: two incidents on the same road (duplicate-ish scenario) both contribute — dedup is an identity concern (clientEventId), not an evidence-suppression concern', () => {
  const road = { physicalStatus: 'OPEN' };
  const incidentA = { type: 'FLOOD', severity: 'MEDIUM', status: 'REPORTED', roadMatchConfidence: 'HIGH', timestamp: NOW };
  const incidentB = { type: 'FLOOD', severity: 'MEDIUM', status: 'REPORTED', roadMatchConfidence: 'HIGH', timestamp: NOW };
  const evidence = [...buildRoadStatusEvidence(road), ...buildIncidentEvidence([incidentA, incidentB], { now: NOW, classifyIncidentFreshness })];
  const fieldFactors = evidence.filter((e) => e.source === 'FIELD_INCIDENT' || e.source === undefined).length;
  const result = computeAccessibilityFromEvidence(evidence, { now: NOW });
  const factorCount = result.factors.filter((f) => f.source === 'FIELD_INCIDENT').length;
  assert.equal(factorCount, 2); // both genuinely-distinct incidents count — idempotency is about not creating duplicate DOCUMENTS, not about suppressing legitimate multiple reports
});
