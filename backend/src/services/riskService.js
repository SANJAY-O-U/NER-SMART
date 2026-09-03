/**
 * Risk Engine Service
 * -------------------
 * Single source of truth for risk scoring. Controllers must call into this
 * service rather than computing risk themselves (see engineering rule: no
 * duplicate risk logic in controllers).
 *
 * Current implementation: JavaScript weighted scoring (Level-2 MVP, no ML).
 *
 * Future upgrade path: this function is intentionally the ONLY place that
 * knows how risk is computed. To swap in the ai-engine team's XGBoost model
 * later, replace the body of `calculateRisk` with a call out to that module
 * (e.g. an HTTP call to the ai-engine service, or a local require if it's
 * mounted in-process) while keeping the same input/output shape below.
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
