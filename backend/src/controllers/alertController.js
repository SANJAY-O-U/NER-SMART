const Alert = require('../models/Alert');
const { success, failure } = require('../utils/response');
const { createAlert } = require('../services/alertService');
const { sanitizeStringParam, isValidEnumValue } = require('../utils/validators');

// GET /api/alerts
// GET /api/alerts?roadId=...
//
// Minimal, additive extension (driver-app alert delivery): an optional
// roadId filter on the SAME existing endpoint, rather than a new one.
// Reuses the Alert model's existing roadId field (Phase 6) — no new
// association logic, no new geographic algorithm.
async function getAlerts(req, res) {
  // Phase 1 hardening: Express's default query parser supports bracket
  // notation (e.g. `?roadId[$ne]=x`), which would otherwise let a caller
  // pass a MongoDB operator object straight into this filter.
  // sanitizeStringParam rejects anything that isn't a genuine string.
  const roadId = sanitizeStringParam(req.query.roadId);
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
  if (type !== undefined && !isValidEnumValue(Alert, 'type', type)) {
    return failure(res, `type must be one of ${Alert.schema.path('type').enumValues.join(', ')}`, 422);
  }
  if (severity !== undefined && !isValidEnumValue(Alert, 'severity', severity)) {
    return failure(res, `severity must be one of ${Alert.schema.path('severity').enumValues.join(', ')}`, 422);
  }

  const alert = await createAlert({ type, severity, message, shipmentId });
  return success(res, alert, 201);
}

module.exports = { getAlerts, postAlert };
