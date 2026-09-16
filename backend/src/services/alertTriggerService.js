/**
 * Alert Trigger Policy (Phase 6G)
 * ---------------------------------
 * Deterministic decision: given a road's accessibility BEFORE and AFTER
 * some event (a new field incident, a resolution, an alert expiring,
 * etc.), should an operational alert be generated? Pure — no DB, no
 * randomness — so the threshold logic is fully unit-testable.
 *
 * Documented, configurable thresholds. Not a scientific claim about what
 * "matters" operationally — an engineering default to avoid spamming an
 * alert for every low-confidence, low-magnitude change while still
 * surfacing genuinely significant ones.
 */

const STATE_RANK = { OPEN: 0, UNKNOWN: 0, HIGH_RISK: 1, RESTRICTED: 2, BLOCKED: 3 };
const SIGNIFICANT_SCORE_DROP = 20; // points, out of 100

/**
 * @param {object} before - { state, accessibilityScore } (or null if no prior data)
 * @param {object} after - { state, accessibilityScore }
 * @returns {{ trigger: boolean, reason: string|null, direction: 'DEGRADED'|'RECOVERED'|null }}
 */
function shouldTriggerAlert(before, after) {
  if (!after) return { trigger: false, reason: null, direction: null };

  // No prior state to compare against (e.g. first-ever evidence for this
  // road) — nothing has "changed" yet, so no alert. The road's initial
  // state is visible via the normal accessibility endpoint, not an alert.
  if (!before) return { trigger: false, reason: null, direction: null };

  const beforeRank = STATE_RANK[before.state] ?? 0;
  const afterRank = STATE_RANK[after.state] ?? 0;

  if (afterRank > beforeRank) {
    return {
      trigger: true,
      reason: `Accessibility state changed from ${before.state} to ${after.state}`,
      direction: 'DEGRADED',
    };
  }

  if (afterRank < beforeRank) {
    return {
      trigger: true,
      reason: `Accessibility state improved from ${before.state} to ${after.state}`,
      direction: 'RECOVERED',
    };
  }

  // Same state, but check for a significant score movement within it
  // (e.g. HIGH_RISK at score 55 vs HIGH_RISK at score 22 are both
  // "HIGH_RISK" but meaningfully different in severity).
  const beforeScore = before.accessibilityScore;
  const afterScore = after.accessibilityScore;
  if (typeof beforeScore === 'number' && typeof afterScore === 'number') {
    const delta = afterScore - beforeScore;
    if (delta <= -SIGNIFICANT_SCORE_DROP) {
      return {
        trigger: true,
        reason: `Accessibility score dropped significantly (${beforeScore} -> ${afterScore}) while remaining ${after.state}`,
        direction: 'DEGRADED',
      };
    }
    if (delta >= SIGNIFICANT_SCORE_DROP) {
      return {
        trigger: true,
        reason: `Accessibility score improved significantly (${beforeScore} -> ${afterScore}) while remaining ${after.state}`,
        direction: 'RECOVERED',
      };
    }
  }

  return { trigger: false, reason: null, direction: null };
}

module.exports = { shouldTriggerAlert, STATE_RANK, SIGNIFICANT_SCORE_DROP };
