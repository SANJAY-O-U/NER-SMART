const { recommendRealRoute, SNAP_MAX_DISTANCE_KM } = require('../services/routingEngineService');
const { failure } = require('../utils/response');

function isValidCoord(pt) {
  return pt && typeof pt.lat === 'number' && typeof pt.lng === 'number' && Number.isFinite(pt.lat) && Number.isFinite(pt.lng) &&
    pt.lat >= -90 && pt.lat <= 90 && pt.lng >= -180 && pt.lng <= 180;
}

const VALID_PRIORITIES = ['NORMAL', 'IMPORTANT', 'EMERGENCY'];

// POST /api/routes/recommend-real
// Body: { origin: {lat,lng}, destination: {lat,lng}, cargoPriority? }
//
// The REAL, graph-based routing engine over the imported road network —
// additive to (not a replacement of) the existing string-based
// /api/routes/recommend demo endpoint, which remains for backward
// compatibility with the screening demo's city-name flow and the
// landslide simulation. See ROUTING_ARCHITECTURE.md.
async function recommendReal(req, res) {
  const { origin, destination, cargoPriority } = req.body;

  if (!isValidCoord(origin)) {
    return failure(res, 'origin must be { lat, lng } with valid coordinates', 422);
  }
  if (!isValidCoord(destination)) {
    return failure(res, 'destination must be { lat, lng } with valid coordinates', 422);
  }
  if (cargoPriority && !VALID_PRIORITIES.includes(cargoPriority)) {
    return failure(res, `cargoPriority must be one of ${VALID_PRIORITIES.join(', ')}`, 422);
  }

  const result = await recommendRealRoute({ origin, destination, cargoPriority: cargoPriority || 'NORMAL' });

  return res.json({ success: true, data: result });
}

module.exports = { recommendReal, SNAP_MAX_DISTANCE_KM };
