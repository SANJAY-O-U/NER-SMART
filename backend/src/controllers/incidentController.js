const Incident = require('../models/Incident');
const { success, failure } = require('../utils/response');
const { analyzeIncident } = require('../services/aiService');
const { associateIncidentWithRoad } = require('../services/incidentRoadAssociation');
const { calculateRisk } = require('../services/riskService');
const { computeAccessibilityForRoad } = require('../services/accessibilityService');
const { shouldTriggerAlert } = require('../services/alertTriggerService');
const { createProvenancedAlert } = require('../services/alertService');

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

/**
 * Phase 6E: recomputes accessibility for a road and checks the Phase 6G
 * deterministic alert threshold against a prior snapshot. Shared by
 * createIncident and updateIncidentStatus so the closed-loop behavior
 * (incident change -> accessibility recompute -> alert if warranted) is
 * identical at both entry points, not duplicated.
 */
async function recomputeAndMaybeAlert({ roadId, incidentId, beforeAccessibility }) {
  const afterAccessibility = await computeAccessibilityForRoad(roadId);
  const decision = shouldTriggerAlert(beforeAccessibility, afterAccessibility);

  let alertGenerated = null;
  if (decision.trigger) {
    alertGenerated = await createProvenancedAlert({
      type: decision.direction === 'DEGRADED' ? 'RISK_WARNING' : 'GENERAL',
      severity: afterAccessibility?.state === 'BLOCKED' ? 'HIGH' : decision.direction === 'DEGRADED' ? 'MEDIUM' : 'LOW',
      message: decision.reason,
      source: 'FIELD_INCIDENT',
      incidentId,
      roadId,
      triggerReason: decision.reason,
    });
  }

  return { afterAccessibility, alertGenerated };
}

// POST /api/incidents
// Body: { type, severity?, lat, lng, description?, source?, reportedBy?, clientEventId? }
//
// This is the golden-path endpoint: Driver (Flutter) -> here -> MongoDB.
// Runs the AI analysis pipeline, associates the nearest known road
// (Phase 6B — GPS-accuracy-aware when available), and recomputes that
// road's accessibility before/after so the closed loop (Phase 6E/6G) is
// visible directly in this response.
//
// Phase 5 idempotency: when `clientEventId` is supplied (offline-first
// field app retries), the SAME eventId always resolves to the SAME
// logical incident — never a duplicate. Race-safe: relies on the
// model's partial unique index, not just a check-then-create (which
// alone would have a TOCTOU gap under concurrent retries).
async function createIncident(req, res) {
  const { type, severity, lat, lng, description, source, reportedBy, locationMode, gpsAccuracyMeters, clientEventId } = req.body;

  if (!type || lat === undefined || lng === undefined) {
    return failure(res, 'type, lat, and lng are required', 422);
  }

  if (clientEventId) {
    const existing = await Incident.findOne({ clientEventId });
    if (existing) {
      // Idempotent replay: same event, already processed. Return the
      // existing incident as-is — never re-run AI/road-association for
      // an event we've already recorded, and never create a duplicate.
      return success(res, { ...existing.toJSON(), idempotentReplay: true });
    }
  }

  // 1. Persist the raw report first (REPORTED) so nothing is lost even if
  //    the AI step below has an issue.
  let incident;
  try {
    incident = await Incident.create({
      type,
      severity: severity || 'MEDIUM',
      lat,
      lng,
      description: description || '',
      source: source || 'DRIVER_APP',
      reportedBy: reportedBy || null,
      clientEventId: clientEventId || null,
      // Phase 4A: only stored when the client actually sent it — never inferred.
      locationMode: locationMode === 'LIVE_GPS' || locationMode === 'NER_DEMO' ? locationMode : null,
      gpsAccuracyMeters: typeof gpsAccuracyMeters === 'number' ? gpsAccuracyMeters : null,
      status: 'REPORTED',
    });
  } catch (err) {
    // Race condition: two concurrent requests with the same clientEventId
    // both passed the findOne check above before either finished
    // creating. MongoDB's unique index rejects the second insert with
    // E11000 — treat that exactly like the idempotent-replay path above
    // rather than surfacing a 500 for what is actually a successful,
    // already-recorded event.
    if (clientEventId && err.code === 11000) {
      const existing = await Incident.findOne({ clientEventId });
      if (existing) {
        return success(res, { ...existing.toJSON(), idempotentReplay: true });
      }
    }
    throw err;
  }

  // 2. AI analysis (real if configured, deterministic fallback otherwise —
  //    this call never throws).
  const aiResult = await analyzeIncident({ type, description });

  // 3. Associate nearest road (Phase 6B: GPS-accuracy-aware when the
  //    incident carries real device accuracy, falling back to the
  //    original distance-only confidence otherwise). Per Phase 1 rules:
  //    only claim a road is AFFECTED at HIGH/MEDIUM confidence. A
  //    LOW/NONE match is still recorded (for transparency) but does NOT
  //    populate roadId/roadName — never invented.
  const now = new Date();
  const association = await associateIncidentWithRoad({ lat, lng, gpsAccuracyMeters: incident.gpsAccuracyMeters, now });

  incident.distanceToRoadKm = association.distanceKm;
  incident.roadMatchConfidence = association.roadMatchConfidence;
  incident.associationMethod = association.associationMethod;
  incident.associationTimestamp = association.associationTimestamp;

  // Phase 6E: snapshot accessibility BEFORE this incident's evidence
  // exists (i.e. before .save() makes it queryable), so the response can
  // show a genuine before/after, not two identical reads.
  let beforeAccessibility = null;
  if (association.road && (association.roadMatchConfidence === 'HIGH' || association.roadMatchConfidence === 'MEDIUM')) {
    incident.roadId = association.road._id;
    incident.roadName = association.road.name;
    beforeAccessibility = await computeAccessibilityForRoad(association.road._id);
  }

  incident.aiResult = aiResult;
  incident.severity = aiResult.severity || incident.severity;
  incident.status = 'AI_ANALYSED';
  await incident.save();

  // 4. If the AI flags HIGH severity, compute a risk score against the
  //    associated road's existing risk factors using the SAME risk engine
  //    the rest of the app uses (no duplicate risk logic).
  let riskImpact = null;
  if (association.road && aiResult.severity === 'HIGH') {
    riskImpact = calculateRisk({
      rainfallScore: association.road.floodRisk,
      slopeScore: association.road.landslideRisk,
      historicalRisk: 50,
      roadCondition: 60,
    });
  }

  // 5. Phase 6E/6G: recompute accessibility now that this incident is
  //    live evidence, and alert if the deterministic threshold is
  //    crossed. Only meaningful once a road is actually associated.
  let accessibilityImpact = null;
  let alertGenerated = null;
  if (incident.roadId) {
    const result = await recomputeAndMaybeAlert({
      roadId: incident.roadId,
      incidentId: incident._id,
      beforeAccessibility,
    });
    accessibilityImpact = { before: beforeAccessibility, after: result.afterAccessibility };
    alertGenerated = result.alertGenerated;
  }

  return success(
    res,
    {
      ...incident.toJSON(),
      roadDistanceKm: association.distanceKm,
      riskImpact,
      accessibilityImpact,
      alertGenerated,
    },
    201
  );
}

// PATCH /api/incidents/:id
// Body: { status }
// Officer-side status transitions: VERIFIED / ACTION_REQUIRED / RESOLVED.
// Phase 6D/6E/6G: resolving an incident (and any other status change on
// a road-associated incident) recomputes that road's accessibility and
// checks the same deterministic alert threshold — e.g. resolving the
// last active incident on a road can trigger a RECOVERED alert.
async function updateIncidentStatus(req, res) {
  const { status } = req.body;

  if (!status || !VALID_STATUSES.includes(status)) {
    return failure(res, `status must be one of ${VALID_STATUSES.join(', ')}`, 422);
  }

  const incident = await Incident.findById(req.params.id);
  if (!incident) return failure(res, 'Incident not found', 404);

  let beforeAccessibility = null;
  if (incident.roadId) {
    beforeAccessibility = await computeAccessibilityForRoad(incident.roadId);
  }

  incident.status = status;
  if (status === 'RESOLVED' && !incident.resolvedAt) {
    incident.resolvedAt = new Date();
  }
  await incident.save();

  let accessibilityImpact = null;
  let alertGenerated = null;
  if (incident.roadId) {
    const result = await recomputeAndMaybeAlert({
      roadId: incident.roadId,
      incidentId: incident._id,
      beforeAccessibility,
    });
    accessibilityImpact = { before: beforeAccessibility, after: result.afterAccessibility };
    alertGenerated = result.alertGenerated;
  }

  return success(res, { ...incident.toJSON(), accessibilityImpact, alertGenerated });
}

module.exports = { getIncidents, getIncident, createIncident, updateIncidentStatus, recomputeAndMaybeAlert };
