const Alert = require('../models/Alert');
const { success, failure } = require('../utils/response');
const { createAlert } = require('../services/alertService');

// GET /api/alerts
// GET /api/alerts?roadId=...
//
// Minimal, additive extension (driver-app alert delivery): an optional
// roadId filter on the SAME existing endpoint, rather than a new one.
// Reuses the Alert model's existing roadId field (Phase 6) — no new
// association logic, no new geographic algorithm.
async function getAlerts(req, res) {
  const { roadId } = req.query;
  const query = roadId ? { roadId } : {};
  const alerts = await Alert.find(query).sort({ timestamp: -1 });
  return success(res, alerts);
}

// POST /api/alerts
async function postAlert(req, res) {
  const { type, severity, message, shipmentId } = req.body;

  if (!message) {
    return failure(res, 'message is required', 422);
  }

  const alert = await createAlert({ type, severity, message, shipmentId });
  return success(res, alert, 201);
}

module.exports = { getAlerts, postAlert };
