/**
 * Route Cost Service
 * -------------------
 * Pure, documented, configurable edge-cost function. Combines travel
 * distance with accessibility-derived risk/restriction/unknown
 * penalties, weighted by cargo priority. This is an engineering
 * heuristic, not a scientifically validated cost model — weights are
 * named constants below, not hidden magic numbers.
 *
 * routeCost = travelCost + riskPenalty + accessibilityPenalty
 *           + restrictionPenalty + unknownEvidencePenalty
 *
 * BLOCKED roads are excluded entirely (handled by the caller/Dijkstra,
 * not priced in here) — this function still reports blocked:true so the
 * caller can act on it.
 */

const CARGO_PRIORITIES = ['NORMAL', 'IMPORTANT', 'EMERGENCY'];

// Per-cargo-priority weight multipliers. Higher riskWeight = more averse
// to risk (willing to travel further to avoid it). Higher
// unknownPenaltyWeight = stronger preference for roads with KNOWN
// accessibility over roads with no evidence at all.
const CARGO_WEIGHTS = {
  NORMAL: { riskWeight: 1.0, unknownPenaltyWeight: 1.0, restrictionWeight: 1.0 },
  IMPORTANT: { riskWeight: 1.8, unknownPenaltyWeight: 1.5, restrictionWeight: 0.7 },
  EMERGENCY: { riskWeight: 2.5, unknownPenaltyWeight: 2.0, restrictionWeight: 0.3 },
};

// Base penalties (in the same "cost units" as travel km) per accessibility state.
const BASE_STATE_PENALTY_KM = {
  OPEN: 0,
  RESTRICTED: 15, // may still be usable — see restrictionWeight above
  HIGH_RISK: 40,
  UNKNOWN: 10, // moderate, configurable — neither "safe" nor "blocked"
};

const BASE_RISK_SCORE_PENALTY_PER_POINT_KM = 0.3; // per point of (100 - accessibilityScore)

/**
 * @param {object} edge - { lengthKm, roadName, roadId }
 * @param {object} accessibility - result of accessibilityService.computeAccessibilityForRoad (or null if not yet computed)
 * @param {'NORMAL'|'IMPORTANT'|'EMERGENCY'} cargoPriority
 * @param {'SAFEST'|'BALANCED'|'SHORTEST'} routeMode - SHORTEST ignores risk weighting (still excludes BLOCKED)
 */
function computeEdgeCost(edge, accessibility, cargoPriority = 'NORMAL', routeMode = 'BALANCED') {
  const weights = CARGO_WEIGHTS[cargoPriority] || CARGO_WEIGHTS.NORMAL;
  const state = accessibility ? accessibility.state : 'UNKNOWN';

  if (state === 'BLOCKED') {
    return { cost: Infinity, blocked: true, state, reasons: [`${edge.roadName} is BLOCKED`] };
  }

  const travelCost = edge.lengthKm;

  if (routeMode === 'SHORTEST') {
    // Shortest-feasible still respects BLOCKED exclusion (above) but
    // otherwise optimizes for distance only, per the mission's request
    // for a genuine shortest-feasible alternative to compare against.
    return { cost: travelCost, blocked: false, state, reasons: [] };
  }

  let penalty = 0;
  const reasons = [];

  const statePenalty = BASE_STATE_PENALTY_KM[state] ?? BASE_STATE_PENALTY_KM.UNKNOWN;
  if (state === 'RESTRICTED') {
    penalty += statePenalty * weights.restrictionWeight;
    reasons.push(`${edge.roadName} is RESTRICTED`);
  } else if (state === 'HIGH_RISK') {
    penalty += statePenalty * weights.riskWeight;
    reasons.push(`${edge.roadName} is HIGH_RISK`);
  } else if (state === 'UNKNOWN') {
    penalty += statePenalty * weights.unknownPenaltyWeight;
    reasons.push(`${edge.roadName} accessibility information unavailable`);
  }

  if (accessibility && accessibility.accessibilityScore !== null && accessibility.accessibilityScore !== undefined) {
    const riskGap = 100 - accessibility.accessibilityScore;
    penalty += riskGap * BASE_RISK_SCORE_PENALTY_PER_POINT_KM * weights.riskWeight;
  }

  return { cost: travelCost + penalty, blocked: false, state, reasons };
}

module.exports = { computeEdgeCost, CARGO_PRIORITIES, CARGO_WEIGHTS, BASE_STATE_PENALTY_KM, BASE_RISK_SCORE_PENALTY_PER_POINT_KM };
