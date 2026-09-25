/**
 * Risk Engine Service (LEGACY / SECONDARY — see Phase 6 consolidation)
 * ----------------------------------------------------------------------
 * Phase 6 architecture audit: this is the screening-demo-era weighted
 * scorer. It is NOT authoritative for operational road accessibility —
 * that role belongs exclusively to accessibilityEngine.js /
 * accessibilityEvidence.js / accessibilityService.js (the evidence-based
 * cascade: Evidence -> Accessibility Evidence -> Accessibility Engine ->
 * OPEN/HIGH_RISK/RESTRICTED/BLOCKED/UNKNOWN). Confirmed by a full-tree
 * dependency trace: accessibilityEngine.js, accessibilityEvidence.js, and
 * accessibilityService.js contain zero references to this module, and
 * nothing this module computes is ever read back into the accessibility
 * pipeline.
 *
 * This service survives only as secondary/compatibility data, consumed
 * exclusively by: `POST /api/risk/predict` (standalone diagnostic
 * endpoint), `POST /api/routes/recommend` (the legacy hardcoded-catalogue
 * demo router — a materially different, non-authoritative concept from
 * the real graph router, which consumes accessibilityService instead),
 * `GET /api/weather/road/:roadId` (a display-only `riskResult` field,
 * unused by the frontend), `POST /api/incidents`' response-only
 * `riskImpact` field (never persisted, never read back — a dead-end
 * value), `POST /api/simulation/landslide` (APP_MODE=demo-gated,
 * demo-road-only), and one-time demo seed data. None of these are
 * operational decisions gated by this service's output — routing
 * exclusion, BLOCKED/RESTRICTED gating, and alert triggering all go
 * through the accessibility engine exclusively. Do not wire this
 * service's output into any new decision path; extend
 * accessibilityEvidence.js instead if a new evidence source is needed.
 *
 * Current implementation: JavaScript weighted scoring (Level-2 MVP, no ML).
 *
 * Future upgrade path: this function is intentionally the ONLY place that
 * knows how this LEGACY score is computed. To swap in the ai-engine team's
 * XGBoost model later, replace the body of `calculateRisk` with a call out
 * to that module (e.g. an HTTP call to the ai-engine service, or a local
 * require if it's mounted in-process) while keeping the same input/output
 * shape below — but this still would not make it authoritative for
 * accessibility without an explicit, separate architectural decision.
 *
 * Input shape:
 * {
 *   rainfallScore: number (0-100),
 *   slopeScore: number (0-100),
 *   historicalRisk: number (0-100),
 *   roadCondition: number (0-100)
 * }
 *
 * Output shape:
 * {
 *   risk: number (0-100),
 *   level: 'LOW' | 'MEDIUM' | 'HIGH'
 * }
 */

const WEIGHTS = {
  rainfallScore: 0.35,
  slopeScore: 0.25,
  historicalRisk: 0.2,
  roadCondition: 0.2,
};

function clamp(value, min = 0, max = 100) {
  const num = Number(value) || 0;
  return Math.min(max, Math.max(min, num));
}

function levelFromScore(score) {
  if (score <= 30) return 'LOW';
  if (score <= 60) return 'MEDIUM';
  return 'HIGH';
}

function calculateRisk({ rainfallScore = 0, slopeScore = 0, historicalRisk = 0, roadCondition = 0 } = {}) {
  const rainfall = clamp(rainfallScore);
  const slope = clamp(slopeScore);
  const historical = clamp(historicalRisk);
  const condition = clamp(roadCondition);

  const rawScore =
    rainfall * WEIGHTS.rainfallScore +
    slope * WEIGHTS.slopeScore +
    historical * WEIGHTS.historicalRisk +
    condition * WEIGHTS.roadCondition;

  const risk = Math.round(rawScore * 100) / 100;

  return {
    risk,
    level: levelFromScore(risk),
  };
}

/**
 * Convenience helper used by the landslide simulation: bumps a road's
 * landslideRisk up sharply while keeping it within bounds.
 */
function escalateLandslideRisk(currentRisk = 0, boost = 40) {
  return clamp((Number(currentRisk) || 0) + boost);
}

module.exports = { calculateRisk, escalateLandslideRisk, levelFromScore };
