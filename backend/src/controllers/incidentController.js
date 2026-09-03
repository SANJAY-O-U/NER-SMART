const Incident = require('../models/Incident');
const { success, failure } = require('../utils/response');

// GET /api/incidents
async function getIncidents(req, res) {
  const incidents = await Incident.find().sort({ timestamp: -1 });
  return success(res, incidents);
}

// POST /api/incidents
async function createIncident(req, res) {
  const { type, severity, lat, lng, description } = req.body;

  if (!type || lat === undefined || lng === undefined) {
    return failure(res, 'type, lat, and lng are required', 422);
  }

  const incident = await Incident.create({ type, severity, lat, lng, description });
  return success(res, incident, 201);
}

module.exports = { getIncidents, createIncident };
