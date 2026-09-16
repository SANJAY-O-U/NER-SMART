const { calculateRisk } = require('../services/riskService');
const { success, failure } = require('../utils/response');

// POST /api/risk/predict
// Body: { rainfallScore, slopeScore, historicalRisk, roadCondition }
async function predictRisk(req, res) {
  const { rainfallScore, slopeScore, historicalRisk, roadCondition } = req.body;

  if (
    [rainfallScore, slopeScore, historicalRisk, roadCondition].some(
      (v) => v === undefined || v === null || Number.isNaN(Number(v))
    )
  ) {
    return failure(res, 'rainfallScore, slopeScore, historicalRisk, and roadCondition are required numbers', 422);
  }

  const result = calculateRisk({ rainfallScore, slopeScore, historicalRisk, roadCondition });
  return success(res, result);
}

module.exports = { predictRisk };
