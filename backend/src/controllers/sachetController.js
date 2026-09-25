const DisasterAlert = require('../models/DisasterAlert');
const Road = require('../models/Road');
const { success, failure } = require('../utils/response');
const { ingestSachetAlerts } = require('../services/sachetService');
const { associateAlertWithRoads } = require('../services/sachetRoadAssociation');
const { computeDisasterRiskContribution } = require('../services/disasterRiskAdapter');
const { isAlertExpired } = require('../services/disasterLifecycleService');

/**
 * Persists one normalized alert: upsert by identifier (the CAP identity),
 * preserving firstSeenAt across updates. Runs road association + risk
 * scoring so every stored alert is immediately queryable by road.
 */
async function persistAlert(normalized) {
  const now = new Date();
  const association = await associateAlertWithRoads(normalized);
  const { score } = computeDisasterRiskContribution(normalized, now);

  const existing = await DisasterAlert.findOne({ identifier: normalized.identifier });

  const update = {
    ...normalized,
    lastSeenAt: now,
    sourceUpdatedAt: normalized.sent || now,
    retrievedAt: now,
    sourceStatus: 'LIVE',
    affectedRoadIds: association.affectedRoadIds,
    associationMethod: association.associationMethod,
    associationConfidence: association.associationConfidence,
    disasterRiskContribution: score,
    lifecycleStatus: normalized.msgType === 'Cancel' ? 'CANCELLED' : existing ? 'UPDATED' : 'ACTIVE',
  };

  if (!existing) {
    update.firstSeenAt = now;
  }

  await DisasterAlert.findOneAndUpdate({ identifier: normalized.identifier }, { $set: update }, { upsert: true, runValidators: true });

  return { isNew: !existing, roadCount: association.matchedRoadCount };
}

/**
 * Marks any ACTIVE/UPDATED alert that is no longer current as EXPIRED —
 * either because CAP's own `expires` has passed, or (Phase 4: `expires`
 * is optional under CAP 1.2 and real SACHET alerts sometimes omit it) it
 * has exceeded the documented no-expiry fallback age. Decision logic
 * lives in the pure, unit-tested disasterLifecycleService.isAlertExpired
 * — this function is just the DB fetch/filter/update around it.
 */
async function expireOldAlerts() {
  const now = new Date();
  const candidates = await DisasterAlert.find(
    { lifecycleStatus: { $in: ['ACTIVE', 'UPDATED'] } },
    '_id expires sent firstSeenAt'
  );
  const idsToExpire = candidates.filter((alert) => isAlertExpired(alert, { now })).map((alert) => alert._id);
  if (!idsToExpire.length) return 0;

  const result = await DisasterAlert.updateMany({ _id: { $in: idsToExpire } }, { $set: { lifecycleStatus: 'EXPIRED' } });
  return result.modifiedCount || 0;
}

// POST /api/sachet/ingest — runs one ingestion pass. Called by the
// scheduler (server.js) and available for manual/test triggering.
async function runIngestion(req, res) {
  const result = await ingestSachetAlerts();

  if (result.status === 'UNAVAILABLE') {
    return success(res, { status: 'UNAVAILABLE', persisted: 0, errors: result.errors });
  }
  if (result.unchanged) {
    const expiredCount = await expireOldAlerts();
    return success(res, { status: 'LIVE', unchanged: true, persisted: 0, expiredCount });
  }

  let persisted = 0;
  let newCount = 0;
  const persistErrors = [];

  for (const alert of result.alerts) {
    try {
      const { isNew } = await persistAlert(alert);
      persisted += 1;
      if (isNew) newCount += 1;
    } catch (err) {
      // One bad alert must not fail the whole ingestion pass.
      persistErrors.push({ identifier: alert.identifier, reason: err.message });
    }
  }

  const expiredCount = await expireOldAlerts();

  return success(res, {
    status: 'LIVE',
    totalCandidates: result.totalCandidates,
    persisted,
    newCount,
    fetchErrors: result.errors,
    persistErrors,
    expiredCount,
  });
}

// GET /api/sachet/alerts — current active NER-relevant alerts.
async function getActiveAlerts(req, res) {
  const alerts = await DisasterAlert.find({ lifecycleStatus: { $in: ['ACTIVE', 'UPDATED'] } })
    .sort({ sent: -1 })
    .select('-rawCapXml');
  return success(res, alerts);
}

// GET /api/sachet/road/:roadId — disaster context for a road.
async function getDisasterContextForRoad(req, res) {
  const road = await Road.findById(req.params.roadId);
  if (!road) return failure(res, 'Road not found', 404);

  const alerts = await DisasterAlert.find({
    affectedRoadIds: road._id,
    lifecycleStatus: { $in: ['ACTIVE', 'UPDATED'] },
  })
    .sort({ disasterRiskContribution: -1 })
    .select('-rawCapXml');

  return success(res, {
    roadId: road.id,
    districtAssignmentMethod: road.districtAssignmentMethod,
    district: road.district,
    activeAlertCount: alerts.length,
    alerts,
  });
}

module.exports = { runIngestion, getActiveAlerts, getDisasterContextForRoad, persistAlert, expireOldAlerts };
