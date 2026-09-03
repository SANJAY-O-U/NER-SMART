const Alert = require('../models/Alert');
const { success, failure } = require('../utils/response');
const { createAlert } = require('../services/alertService');

// GET /api/alerts
async function getAlerts(req, res) {
  const alerts = await Alert.find().sort({ timestamp: -1 });
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
