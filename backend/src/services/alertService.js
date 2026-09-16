const Alert = require('../models/Alert');

/**
 * Creates and persists a single alert. Shared so alert-creation logic
 * (e.g. from the landslide simulation) isn't duplicated across controllers.
 */
async function createAlert({ type = 'GENERAL', severity = 'MEDIUM', message, shipmentId = null }) {
  return Alert.create({ type, severity, message, shipmentId });
}

const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour — documented default, avoids re-alerting on repeated recomputation of the same transition

/**
 * Phase 6G: creates a provenanced closed-loop alert — always traceable
 * to the incident/road/reason that produced it. Used by
 * incidentController when a field incident's accessibility impact
 * crosses the deterministic threshold in alertTriggerService.js.
 *
 * Deduplicated: if an alert with the SAME incidentId + roadId +
 * triggerReason was already generated within the dedup window, this
 * returns null instead of creating a duplicate — repeated recomputation
 * of an unchanged transition (e.g. two near-simultaneous requests) must
 * not spam identical alerts.
 */
async function createProvenancedAlert({ type, severity, message, source, incidentId, roadId, triggerReason }) {
  const now = new Date();

  const existing = await Alert.findOne({
    incidentId,
    roadId,
    triggerReason,
    generatedAt: { $gte: new Date(now.getTime() - DEDUP_WINDOW_MS) },
  });
  if (existing) return null;

  return Alert.create({
    type,
    severity,
    message,
    source,
    incidentId,
    roadId,
    triggerReason,
    generatedAt: now,
    timestamp: now,
  });
}

/**
 * Creates one alert per shipment (used when a road block affects multiple
 * shipments at once).
 */
async function createAlertsForShipments(shipmentIds, { type, severity, messageFor }) {
  const alerts = await Promise.all(
    shipmentIds.map((id) =>
      createAlert({
        type,
        severity,
        shipmentId: id,
        message: typeof messageFor === 'function' ? messageFor(id) : messageFor,
      })
    )
  );
  return alerts;
}

module.exports = { createAlert, createAlertsForShipments, createProvenancedAlert };
