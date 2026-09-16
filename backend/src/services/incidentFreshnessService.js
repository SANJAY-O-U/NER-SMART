/**
 * Incident Freshness Policy
 * --------------------------
 * Phase 6D: field observations must have temporal behavior — an old,
 * unresolved incident should not go on contributing full-strength "LIVE"
 * accessibility evidence forever. This is a small, pure, documented
 * policy module, deliberately separate from accessibilityEvidence.js so
 * it's independently unit-testable.
 *
 * Policy (engineering default, not derived from validated field data):
 *   age <= STALE_AFTER_HOURS  -> LIVE   (full-strength evidence)
 *   age  > STALE_AFTER_HOURS  -> STALE  (still shown, but excluded from
 *                                        the accessibility engine's
 *                                        active-evidence cascade — see
 *                                        accessibilityEngine.js's
 *                                        isStale() check, unchanged)
 * RESOLVED incidents are handled separately (excluded entirely by
 * accessibilityEvidence.js's buildIncidentEvidence, unchanged from
 * Phase 4B) — this module only concerns UNRESOLVED-but-aging incidents.
 */

const STALE_AFTER_HOURS = 72; // 3 days — documented default, configurable via param for tests

function incidentAgeHours(incident, now = new Date()) {
  const reference = incident.timestamp || incident.createdAt;
  if (!reference) return Infinity; // no timestamp at all -> treat as maximally stale, never fabricate freshness
  return (now.getTime() - new Date(reference).getTime()) / (1000 * 60 * 60);
}

/**
 * @returns 'LIVE' | 'STALE'
 */
function classifyIncidentFreshness(incident, { now = new Date(), staleAfterHours = STALE_AFTER_HOURS } = {}) {
  const ageHours = incidentAgeHours(incident, now);
  return ageHours <= staleAfterHours ? 'LIVE' : 'STALE';
}

module.exports = { classifyIncidentFreshness, incidentAgeHours, STALE_AFTER_HOURS };
