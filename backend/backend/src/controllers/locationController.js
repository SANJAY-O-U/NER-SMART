const { findNearestRoadGeo } = require('../services/geoService');
const { classifyRoadMatchConfidence } = require('../services/locationMatchService');
const { failure } = require('../utils/response');

function isValidLat(v) {
  return Number.isFinite(v) && v >= -90 && v <= 90;
}
function isValidLng(v) {
  return Number.isFinite(v) && v >= -180 && v <= 180;
}

// GET /api/roads/nearest?lat={lat}&lng={lng}&accuracyMeters={accuracy}
//
// Real-time GPS -> nearest real road matching. Uses the SAME MongoDB
// 2dsphere query as the rest of the app (geoService.findNearestRoadGeo)
// — no separate/fake matching logic. Confidence considers BOTH the
// distance to the matched road AND the GPS fix's own accuracy (see
// locationMatchService.js) — a tiny road distance with a huge GPS
// accuracy circle is never reported as a confident match.
//
// Response contract (both branches):
//   { matched: true,  road: {...}, distanceMeters, gpsAccuracyMeters, confidence, method: "MONGODB_2DSPHERE" }
//   { matched: false, reason: "NO_ROAD_WITHIN_THRESHOLD", message, confidence: "LOW" }
async function getNearestRoad(req, res) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const accuracyMeters = req.query.accuracyMeters !== undefined ? Number(req.query.accuracyMeters) : null;

  if (req.query.lat === undefined || req.query.lng === undefined) {
    return failure(res, 'lat and lng query parameters are required', 422);
  }
  if (!isValidLat(lat)) {
    return failure(res, 'lat must be a number between -90 and 90', 422);
  }
  if (!isValidLng(lng)) {
    return failure(res, 'lng must be a number between -180 and 180', 422);
  }
  if (accuracyMeters !== null && (!Number.isFinite(accuracyMeters) || accuracyMeters < 0)) {
    return failure(res, 'accuracyMeters must be a non-negative number', 422);
  }

  // Real MongoDB 2dsphere geospatial query — the same one Phase 1's
  // incident-association flow uses. No manual coordinate scanning.
  let geoResult;
  try {
    geoResult = await findNearestRoadGeo(lat, lng);
  } catch (err) {
    // Distinguish a genuine backend/DB failure from "no road nearby" —
    // the mission is explicit that these must not be conflated.
    return res.status(503).json({
      success: false,
      error: 'Road network database temporarily unavailable. Please try again.',
    });
  }

  if (!geoResult) {
    return res.json({
      success: true,
      data: {
        matched: false,
        reason: 'NO_ROAD_WITHIN_THRESHOLD',
        message: 'Road network coverage unavailable for this location.',
        confidence: 'LOW',
      },
    });
  }

  const distanceMeters = Math.round(geoResult.distanceKm * 1000);
  const confidence = classifyRoadMatchConfidence({ distanceMeters, gpsAccuracyMeters: accuracyMeters });

  if (confidence === 'NONE') {
    return res.json({
      success: true,
      data: {
        matched: false,
        reason: 'NO_ROAD_WITHIN_THRESHOLD',
        message: 'Road network coverage unavailable for this location.',
        confidence: 'LOW',
      },
    });
  }

  const road = geoResult.road;

  return res.json({
    success: true,
    data: {
      matched: true,
      road: {
        id: road.id || road._id,
        name: road.name,
        state: road.state || null,
        district: road.district || null,
        corridor: road.corridor || null,
        geometry: road.geometry || null,
      },
      distanceMeters,
      gpsAccuracyMeters: accuracyMeters,
      confidence,
      method: 'MONGODB_2DSPHERE',
    },
  });
}

module.exports = { getNearestRoad, isValidLat, isValidLng };
