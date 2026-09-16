/**
 * Accessibility Engine
 * ---------------------
 * The core deterministic decision algorithm. Takes a list of normalized
 * evidence items (see accessibilityEvidence.js) and produces the
 * structured accessibility contract. Pure — same input always produces
 * the same output, no DB, no network, no randomness — so this is fully
 * unit-testable without touching MongoDB (the sandbox's actual
 * constraint throughout this project).
 *
 * This is a DOCUMENTED ENGINEERING HEURISTIC, not a trained or
 * validated model. Never describe its output as "scientifically
 * validated" or cite an accuracy percentage.
 */

const HIGH_RISK_SCORE_THRESHOLD = 60;
const STATUS_SCORE_PENALTY = { OPEN: 0, RESTRICTED: 30, HIGH_RISK: 50, BLOCKED: 90 };
const RISK_SCORE_WEIGHT = 0.5;

const CONFIDENCE_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };
const RANK_TO_CONFIDENCE = { 3: 'HIGH', 2: 'MEDIUM', 1: 'LOW' };

function isMeaningful(item) {
  return (item.status && item.status !== 'UNKNOWN') || (item.riskContribution !== null && item.riskContribution !== undefined);
}

function isStale(item) {
  return item.freshness === 'STALE' || item.freshness === 'UNAVAILABLE';
}

/**
 * Determines the operational STATE via the explicit priority cascade
 * required by the mission: verified closure/restriction evidence always
 * outranks inferred risk. A SACHET alert, weather reading, or GPS report
 * alone can NEVER produce BLOCKED — only explicit physicalStatus/
 * officialStatus/fieldStatus evidence can.
 */
function determineState(evidence) {
  const active = evidence.filter((e) => isMeaningful(e) && !isStale(e));

  const hasStatus = (status) => active.some((e) => e.status === status);

  if (hasStatus('BLOCKED')) return 'BLOCKED';
  if (hasStatus('RESTRICTED')) return 'RESTRICTED';

  const hasHighRiskStatus = hasStatus('HIGH_RISK');
  const hasHighRiskScore = active.some(
    (e) => e.riskContribution !== null && e.riskContribution !== undefined && e.riskContribution >= HIGH_RISK_SCORE_THRESHOLD
  );
  if (hasHighRiskStatus || hasHighRiskScore) return 'HIGH_RISK';

  if (active.length > 0) return 'OPEN';

  return 'UNKNOWN';
}

/**
 * Computes the transparent 0-100 score, independently of (but generally
 * consistent with) the state above — the STATE always comes from the
 * explicit-evidence cascade, never derived backward from the score.
 */
function computeScore(evidence) {
  const meaningful = evidence.filter(isMeaningful);
  if (meaningful.length === 0) return null;

  let score = 100;
  for (const item of meaningful) {
    if (item.status && STATUS_SCORE_PENALTY[item.status] !== undefined) {
      score -= STATUS_SCORE_PENALTY[item.status];
    }
    if (item.riskContribution !== null && item.riskContribution !== undefined) {
      score -= item.riskContribution * RISK_SCORE_WEIGHT;
    }
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Confidence depends on source count, freshness, and agreement —
 * NOT on how severe the risk is. HIGH_RISK + LOW_CONFIDENCE is valid.
 */
function computeConfidence(evidence) {
  const meaningful = evidence.filter(isMeaningful);
  if (meaningful.length === 0) return null;

  const distinctSources = new Set(meaningful.map((e) => e.source));
  let rank = distinctSources.size >= 3 ? CONFIDENCE_RANK.HIGH : distinctSources.size === 2 ? CONFIDENCE_RANK.MEDIUM : CONFIDENCE_RANK.LOW;

  const fresh = meaningful.filter((e) => !isStale(e));
  const impliesLow = fresh.some((e) => e.status === 'OPEN' || (e.riskContribution !== null && e.riskContribution < 20));
  const impliesElevated = fresh.some(
    (e) =>
      e.status === 'RESTRICTED' ||
      e.status === 'HIGH_RISK' ||
      e.status === 'BLOCKED' ||
      (e.riskContribution !== null && e.riskContribution >= HIGH_RISK_SCORE_THRESHOLD)
  );
  const conflicting = impliesLow && impliesElevated;
  if (conflicting) rank = Math.max(CONFIDENCE_RANK.LOW, rank - 1);

  const hasLowConfidenceEvidence = meaningful.some((e) => e.confidence === 'LOW');
  if (hasLowConfidenceEvidence) rank = Math.max(CONFIDENCE_RANK.LOW, rank - 1);

  return RANK_TO_CONFIDENCE[rank];
}

/**
 * Builds a human-readable explanation directly from the actual evidence
 * that drove the decision — never from an LLM, always traceable to a
 * specific factor.
 */
function buildExplanation(evidence, state, confidence) {
  const meaningful = evidence.filter(isMeaningful);
  if (meaningful.length === 0) {
    return 'No evidence is currently available for this road — accessibility is UNKNOWN.';
  }

  const parts = [];

  const blocking = meaningful.find((e) => e.status === 'BLOCKED');
  const restricting = meaningful.find((e) => e.status === 'RESTRICTED');
  const highRiskStatus = meaningful.find((e) => e.status === 'HIGH_RISK');
  const highRiskScore = meaningful.find((e) => e.riskContribution >= HIGH_RISK_SCORE_THRESHOLD);
  const openStatus = meaningful.find((e) => e.status === 'OPEN' && !isStale(e));

  if (blocking) {
    parts.push(`${blocking.detail} — treated as authoritative closure evidence.`);
  } else if (restricting) {
    parts.push(`${restricting.detail} — treated as an official restriction.`);
  } else {
    if (highRiskScore) parts.push(`${highRiskScore.detail} increases exposure.`);
    else if (highRiskStatus) parts.push(`${highRiskStatus.detail}.`);
    if (openStatus && (highRiskScore || highRiskStatus)) {
      parts.push(`However, ${openStatus.detail}.`);
    }
  }

  if (!blocking && !restricting && !highRiskScore && !highRiskStatus) {
    parts.push('No significant hazard evidence found; road is treated as accessible.');
  }

  parts.push(`Therefore ${state}.`);
  parts.push(`Overall confidence ${confidence || 'UNKNOWN'} based on ${new Set(meaningful.map((e) => e.source)).size} independent source(s).`);

  return parts.join(' ');
}

/**
 * Main entry point: evidence items in, full accessibility contract out.
 */
function computeAccessibilityFromEvidence(evidence = [], { now = new Date() } = {}) {
  const state = determineState(evidence);
  const score = computeScore(evidence);
  const confidence = computeConfidence(evidence);
  const explanation = buildExplanation(evidence, state, confidence);

  const factors = evidence
    .filter(isMeaningful)
    .map((e) => ({
      name: e.type,
      value: e.riskContribution !== null && e.riskContribution !== undefined ? e.riskContribution / 100 : null,
      contribution:
        e.riskContribution !== null && e.riskContribution !== undefined
          ? -Math.round(e.riskContribution * RISK_SCORE_WEIGHT)
          : e.status && STATUS_SCORE_PENALTY[e.status] !== undefined
          ? -STATUS_SCORE_PENALTY[e.status]
          : null,
      source: e.source,
      freshness: e.freshness,
      confidence: e.confidence,
    }));

  const evidenceList = evidence.map((e) => ({
    source: e.source,
    type: e.type,
    timestamp: e.timestamp,
    associationMethod: e.associationMethod,
  }));

  return {
    accessibilityScore: score,
    state,
    confidence,
    factors,
    evidence: evidenceList,
    explanation,
    calculatedAt: now,
  };
}

module.exports = {
  computeAccessibilityFromEvidence,
  determineState,
  computeScore,
  computeConfidence,
  buildExplanation,
  HIGH_RISK_SCORE_THRESHOLD,
  STATUS_SCORE_PENALTY,
  RISK_SCORE_WEIGHT,
};
