const { computeAccessibilityForRoad } = require('../services/accessibilityService');
const { success, failure } = require('../utils/response');

// GET /api/roads/:roadId/accessibility
async function getRoadAccessibility(req, res) {
  const result = await computeAccessibilityForRoad(req.params.roadId);
  if (!result) return failure(res, 'Road not found', 404);
  return success(res, result);
}

module.exports = { getRoadAccessibility };
