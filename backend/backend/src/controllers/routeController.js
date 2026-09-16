const { recommendRoute } = require('../services/routingService');
const Road = require('../models/Road');
const { success, failure } = require('../utils/response');

// POST /api/routes/recommend
// Body: { origin, destination, shipmentPriority }
async function recommend(req, res) {
  const { origin, destination, shipmentPriority } = req.body;

  if (!origin || !destination) {
    return failure(res, 'origin and destination are required', 422);
  }

  const blockedRoads = await Road.find({ status: 'BLOCKED' }).select('name');
  const excludeRoadNames = blockedRoads.map((r) => r.name);

  const result = recommendRoute({ origin, destination, shipmentPriority, excludeRoadNames });
  return success(res, result);
}

module.exports = { recommend };
