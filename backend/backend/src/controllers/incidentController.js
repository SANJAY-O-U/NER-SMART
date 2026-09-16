const Incident = require('../models/Incident');
const { success, failure } = require('../utils/response');
const { analyzeIncident } = require('../services/aiService');
const { findNearestRoad } = require('../services/geoService');
const { calculateRisk } = require('../services/riskService');

const VALID_STATUSES = ['REPORTED', 'AI_ANALYSED', 'VERIFIED', 'ACTION_REQUIRED', 'RESOLVED'];

// GET /api/incidents
async function getIncidents(req, res) {
  const incidents = await Incident.find().sort({ timestamp: -1 });
  return success(res, incidents);
}

// GET /api/incidents/:id
async function getIncident(req, res) {
  const incident = await Incident.findById(req.params.id);
  if (!incident) return failure(res, 'Incident not found', 404);
  return success(res, incident);
}

// POST /api/incidents
// Body: { type, severity?, lat, lng, description?, source?, reportedBy? }
//
// This is the golden-path endpoint: Driver (Flutter) -> here -> MongoDB.
// Runs the AI analysis pipeline and associates the nearest known road so
// the existing risk/routing services can be bridged in.
async function createIncident(req, res) {
  const { type, severity, lat, lng, description, source, reportedBy, locationMode, gpsAccuracyMeters } = req.body;

  if (!type || lat === undefined || lng === undefined) {
    return failure(res, 'type, lat, and lng are required', 422);
  }

  // 1. Persist the raw report first (REPORTED) so nothing is lost even if
  //    the AI step below has an issue.
  const incident = await Incident.create({
    type,
    severity: severity || 'MEDIUM',
    lat,
    lng,
    description: description || '',
    source: source || 'DRIVER_APP',
    reportedBy: reportedBy || null,
    // Phase 4A: only stored when the client actually sent it — never inferred.
    locationMode: locationMode === 'LIVE_GPS' || locationMode === 'NER_DEMO' ? locationMode : null,
    gpsAccuracyMeters: typeof gpsAccuracyMeters === 'number' ? gpsAccuracyMeters : null,
    status: 'REPORTED',
  });

  // 2. AI analysis (real if configured, deterministic fallback otherwise —
  //    this call never throws).
  const aiResult = await analyzeIncident({ type, description });

  // 3. Associate nearest road using the real geospatial index where
  //    available (falls back to point comparison for prototype roads).
  //    Per Phase 1 rules: only claim a road is AFFECTED at HIGH/MEDIUM
  //    confidence. A LOW/NONE match is still recorded (for transparency)
  //    but does NOT populate roadId/roadName.
  const nearest = await findNearestRoad(lat, lng);

  incident.aiResult = aiResult;
  incident.severity = aiResult.severity || incident.severity;
  incident.status = 'AI_ANALYSED';
  if (nearest) {
    incident.distanceToRoadKm = nearest.distanceKm;
    incident.roadMatchConfidence = nearest.confidence;
    if (nearest.confidence === 'HIGH' || nearest.confidence === 'MEDIUM') {
      incident.roadId = nearest.road._id;
      incident.roadName = nearest.road.name;
    }
  } else {
    incident.roadMatchConfidence = 'NONE';
  }
  await incident.save();

  // 4. If the AI flags HIGH severity, compute a risk score against the
  //    associated road's existing risk factors using the SAME risk engine
  //    the rest of the app uses (no duplicate risk logic).
  let riskImpact = null;
  if (nearest && aiResult.severity === 'HIGH') {
    riskImpact = calculateRisk({
      rainfallScore: nearest.road.floodRisk,
      slopeScore: nearest.road.landslideRisk,
      historicalRisk: 50,
      roadCondition: 60,
    });
  }

  return success(
    res,
    {
      ...incident.toJSON(),
      roadDistanceKm: nearest ? nearest.distanceKm : null,
      riskImpact,
    },
    201
  );
}

// PATCH /api/incidents/:id
// Body: { status }
// Officer-side status transitions: VERIFIED / ACTION_REQUIRED / RESOLVED.
async function updateIncidentStatus(req, res) {
  const { status } = req.body;

  if (!status || !VALID_STATUSES.includes(status)) {
    return failure(res, `status must be one of ${VALID_STATUSES.join(', ')}`, 422);
  }

  const incident = await Incident.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true, runValidators: true }
  );
  if (!incident) return failure(res, 'Incident not found', 404);

  return success(res, incident);
}

module.exports = { getIncidents, getIncident, createIncident, updateIncidentStatus };
