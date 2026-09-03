const Road = require('../models/Road');
const { success, failure } = require('../utils/response');

// GET /api/roads
async function getRoads(req, res) {
  const roads = await Road.find().sort({ name: 1 });
  return success(res, roads);
}

// PATCH /api/roads/:id
async function updateRoad(req, res) {
  const allowedFields = ['name', 'status', 'lat', 'lng', 'floodRisk', 'landslideRisk'];
  const updates = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  const road = await Road.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!road) return failure(res, 'Road not found', 404);

  return success(res, road);
}

module.exports = { getRoads, updateRoad };
