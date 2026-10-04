const crypto = require('crypto');
const Incident = require('../models/Incident');
const Road = require('../models/Road');
const { success, failure } = require('../utils/response');
const { analyzeIncident } = require('../services/aiService');
const { associateIncidentWithRoad } = require('../services/incidentRoadAssociation');
const { calculateRisk } = require('../services/riskService');
const { computeAccessibilityForRoad } = require('../services/accessibilityService');
const { shouldTriggerAlert } = require('../services/alertTriggerService');
const { createProvenancedAlert } = require('../services/alertService');
const { isValidEnumValue, isValidLat, isValidLng } = require('../utils/validators');

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

// ---------------------------------------------------------------------------
// Phase 11.2 (I5): resumable incident processing
//
// The raw report is persisted FIRST (unchanged). Everything after that is a
// pipeline of re-runnable steps whose results are checkpointed as they finish:
//
//   1. AI analysis            -> checkpoint { aiResult }
//   2. road association       -> checkpoint { association fields, roadId/roadName
//                                 (HIGH/MEDIUM only), status REPORTED -> AI_ANALYSED }
//   3. accessibility BEFORE   -> counterfactual: this road WITHOUT this incident
//      accessibility AFTER       (excludeIncidentId), so it is correct at any time
//      alert if warranted        and does not depend on step order
//   4. completion             -> checkpoint { processingState: COMPLETE }
//
// A step is skipped when its checkpoint already exists, so a retry resumes where
// the previous attempt stopped. processingState (see models/Incident.js) records
// whether the pipeline finished; an incident is replayed as-is ONLY when COMPLETE.
//
// Ownership: exactly one request runs the pipeline at a time. A request claims the
// incident atomically (findOneAndUpdate on processingState) and gets a fencing
// token; every checkpoint is conditional on that token, so a request whose lease
// expired and was taken over can never overwrite the new owner's work. The lease
// only matters for a crashed/stalled owner — a normal failure releases the claim.
//
// Alert re-runs are safe: createProvenancedAlert already deduplicates on
// (incidentId, roadId, triggerReason) within DEDUP_WINDOW_MS.
// ---------------------------------------------------------------------------

// Longer than a normal run (Gemini <= 10 s + a few DB round trips) with wide margin.
const PROCESSING_LEASE_MS = 2 * 60 * 1000;

const PROCESSING_CONFLICT_MESSAGE = 'Incident is still being processed — retry shortly';

class ClaimLostError extends Error {
  constructor() {
    super('incident processing claim was lost');
    this.name = 'ClaimLostError';
  }
}

/** True when the incident needs no further processing and can be replayed as-is. */
function isProcessingComplete(incident) {
  if (incident.processingState) return incident.processingState === 'COMPLETE';
  return incident.status !== 'REPORTED'; // legacy row (no processing state): REPORTED = never processed
}

/**
 * Atomically claims an incomplete incident for processing. Returns
 * { incident, claimId } or null when it is complete or owned by a live claim.
 */
async function claimForProcessing(incidentId, now = new Date()) {
  const claimId = crypto.randomUUID();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  const incident = await Incident.findOneAndUpdate(
    {
      _id: incidentId,
      $or: [
        { processingState: 'PENDING' },
        { processingState: 'IN_PROGRESS', processingClaimedAt: { $lt: staleBefore } }, // owner crashed / lease expired
        { processingState: null, status: 'REPORTED' }, // legacy never-processed row
      ],
    },
    { $set: { processingState: 'IN_PROGRESS', processingClaimedAt: now, processingClaimId: claimId } },
    { new: true }
  );
  return incident ? { incident, claimId } : null;
}

/** Persists one step's result, only while this request still owns the claim. */
async function checkpoint(incident, claimId, fields) {
  const result = await Incident.updateOne({ _id: incident._id, processingClaimId: claimId }, { $set: fields }, { runValidators: true });
  if (!result || result.matchedCount !== 1) throw new ClaimLostError();
  incident.set(fields); // keep the in-memory document (used for the response) in step
}

/** Gives the claim back after a failed attempt so the next retry can resume. Never throws. */
async function releaseClaim(incidentId, claimId) {
  try {
    await Incident.updateOne(
      { _id: incidentId, processingClaimId: claimId, processingState: 'IN_PROGRESS' },
      { $set: { processingState: 'PENDING', processingClaimedAt: null, processingClaimId: null } }
    );
  } catch (_err) {
    // Best effort: if even this fails the lease expiry makes the incident claimable again.
  }
}

/** Runs the remaining steps for a claimed incident. Re-runnable: finished steps are skipped. */
async function processIncident(incident, claimId) {
  // 1. AI analysis (real if configured, deterministic fallback otherwise).
  // Phase 5: aiResult is AI ASSISTANCE (classification/summary/severity hint/
  // confidence/rationale for the operator), never authoritative — it is stored
  // as-is but must NEVER overwrite the incident's own severity field, since that
  // field is what buildIncidentEvidence reads into the deterministic accessibility
  // engine. Silently letting AI's severity read drive accessibility would violate
  // the accessibility firewall.
  if (!incident.aiResult || !incident.aiResult.source) {
    const aiResult = await analyzeIncident({ type: incident.type, description: incident.description });
    await checkpoint(incident, claimId, { aiResult });
  }

  // 2. Associate nearest road (Phase 6B: GPS-accuracy-aware when the incident
  //    carries real device accuracy, falling back to the original distance-only
  //    confidence otherwise). Per Phase 1 rules: only claim a road is AFFECTED at
  //    HIGH/MEDIUM confidence. A LOW/NONE match is still recorded (for
  //    transparency) but does NOT populate roadId/roadName — never invented.
  let association = null;
  if (!incident.associationTimestamp) {
    association = await associateIncidentWithRoad({
      lat: incident.lat,
      lng: incident.lng,
      gpsAccuracyMeters: incident.gpsAccuracyMeters,
      now: new Date(),
    });
    const fields = {
      distanceToRoadKm: association.distanceKm,
      roadMatchConfidence: association.roadMatchConfidence,
      associationMethod: association.associationMethod,
      associationTimestamp: association.associationTimestamp,
    };
    if (association.road && (association.roadMatchConfidence === 'HIGH' || association.roadMatchConfidence === 'MEDIUM')) {
      fields.roadId = association.road._id;
      fields.roadName = association.road.name;
    }
    if (incident.status === 'REPORTED') fields.status = 'AI_ANALYSED'; // never regress an officer-set status
    await checkpoint(incident, claimId, fields);
  }

  // Phase 6E: accessibility BEFORE this incident's evidence — computed as the
  // road without this incident, so it is a genuine before/after at any moment.
  let beforeAccessibility = null;
  if (incident.roadId) {
    beforeAccessibility = await computeAccessibilityForRoad(incident.roadId, { excludeIncidentId: incident._id });
  }

  // 3. If the AI flags HIGH severity, compute a risk score against the associated
  //    road's existing risk factors using the SAME risk engine the rest of the app
  //    uses (response-only; never persisted).
  const riskRoad = association ? association.road : incident.roadId ? await Road.findById(incident.roadId) : null;
  let riskImpact = null;
  if (riskRoad && incident.aiResult.severity === 'HIGH') {
    riskImpact = calculateRisk({
      rainfallScore: riskRoad.floodRisk,
      slopeScore: riskRoad.landslideRisk,
      historicalRisk: 50,
      roadCondition: 60,
    });
  }

  // 4. Phase 6E/6G: recompute accessibility now that this incident is live
  //    evidence, and alert if the deterministic threshold is crossed. Only
  //    meaningful once a road is actually associated.
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

  // 5. Done: from here a replay returns the record as-is.
  await checkpoint(incident, claimId, { processingState: 'COMPLETE', processingClaimedAt: null, processingClaimId: null });

  return { riskImpact, accessibilityImpact, alertGenerated };
}

/** Runs the pipeline for a claimed incident and shapes the HTTP response. */
async function runProcessing(res, incident, claimId, httpStatus, extra = {}) {
  let outcome;
  try {
    outcome = await processIncident(incident, claimId);
  } catch (err) {
    await releaseClaim(incident._id, claimId); // the next retry resumes from the last checkpoint
    if (err instanceof ClaimLostError) return failure(res, PROCESSING_CONFLICT_MESSAGE, 409);
    throw err; // -> 500 via the central handler (sanitized in production), unchanged contract
  }
  return success(res, { ...incident.toJSON(), roadDistanceKm: incident.distanceToRoadKm, ...outcome, ...extra }, httpStatus);
}

/**
 * An incident with this clientEventId already exists:
 *  - complete            -> idempotent replay, returned as-is (unchanged behaviour);
 *  - incomplete          -> claim it and RESUME the pipeline (never a false success);
 *  - owned by a live run -> 409 so the client retries instead of assuming success.
 */
async function handleExistingIncident(res, existing) {
  if (isProcessingComplete(existing)) {
    return success(res, { ...existing.toJSON(), idempotentReplay: true });
  }
  const claim = await claimForProcessing(existing._id);
  if (!claim) {
    // Lost the claim race, or it finished between our read and the claim: look again.
    const fresh = await Incident.findById(existing._id);
    if (fresh && isProcessingComplete(fresh)) return success(res, { ...fresh.toJSON(), idempotentReplay: true });
    return failure(res, PROCESSING_CONFLICT_MESSAGE, 409);
  }
  return runProcessing(res, claim.incident, claim.claimId, 200, { idempotentReplay: true, resumed: true });
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
//
// Phase 11.2: a retry of an incident whose processing did not finish RESUMES it
// (see the block above) instead of being returned as a finished replay.
async function createIncident(req, res) {
  const { type, severity, lat, lng, description, source, reportedBy, locationMode, gpsAccuracyMeters, clientEventId } = req.body;

  if (!type || lat === undefined || lng === undefined) {
    return failure(res, 'type, lat, and lng are required', 422);
  }
  if (!isValidEnumValue(Incident, 'type', type)) {
    return failure(res, `type must be one of ${Incident.schema.path('type').enumValues.join(', ')}`, 422);
  }
  if (severity !== undefined && !isValidEnumValue(Incident, 'severity', severity)) {
    return failure(res, `severity must be one of ${Incident.schema.path('severity').enumValues.join(', ')}`, 422);
  }
  if (!isValidLat(Number(lat)) || !isValidLng(Number(lng))) {
    return failure(res, 'lat must be -90..90 and lng must be -180..180', 422);
  }

  // The idempotency key is a client-generated STRING. Anything else (an operator-shaped
  // object such as { $ne: null } or { $regex }, an array, a number, null...) must never
  // reach the lookup below: Mongoose would cast it into a query operator and could select
  // an arbitrary incident, which the resume logic would then claim and process.
  // Absent (undefined) stays valid: the field is optional. The empty string keeps its
  // existing meaning (no key).
  if (clientEventId !== undefined && typeof clientEventId !== 'string') {
    return failure(res, 'clientEventId must be a string', 422);
  }

  if (clientEventId) {
    const existing = await Incident.findOne({ clientEventId });
    if (existing) return handleExistingIncident(res, existing);
  }

  // 1. Persist the raw report first (REPORTED) so nothing is lost even if a
  //    later step fails. It is created already claimed by this request.
  const claimId = crypto.randomUUID();
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
      processingState: 'IN_PROGRESS',
      processingClaimedAt: new Date(),
      processingClaimId: claimId,
    });
  } catch (err) {
    // Race condition: two concurrent requests with the same clientEventId
    // both passed the findOne check above before either finished
    // creating. MongoDB's unique index rejects the second insert with
    // E11000 — treat that exactly like the existing-incident path above
    // (replay if complete, resume if not) rather than surfacing a 500 for
    // what is actually an already-recorded event.
    if (clientEventId && err.code === 11000) {
      const existing = await Incident.findOne({ clientEventId });
      if (existing) return handleExistingIncident(res, existing);
    }
    throw err;
  }

  return runProcessing(res, incident, claimId, 201);
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
