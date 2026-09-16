/**
 * Geo Service
 * -----------
 * Two nearest-road strategies, used together:
 *
 *   findNearestRoadGeo()  — REAL geospatial query against MongoDB's
 *                           2dsphere index on `geometry`. Used for any
 *                           road imported with real LineString geometry
 *                           (see scripts/importRoadNetwork.js).
 *
 *   findNearestRoadPoint() — the original Phase-0 straight-line lat/lng
 *                           comparison. Kept as a fallback for roads that
 *                           only have a lat/lng point (the screening-demo's
 *                           5 prototype roads have no `geometry`).
 *
 * findNearestRoad() tries the geo query first (more accurate — it measures
 * distance to the actual road alignment, not a single point) and falls
 * back to the point comparison only if no geometry-bearing road is found
 * nearby. This keeps every existing caller (incidentController) working
 * unchanged while getting real results once real roads exist.
 */

const Road = require('../models/Road');

// Confidence thresholds (km) — configurable here, documented in
// DATA_PROVENANCE.md. These are engineering judgement calls, not derived
// from any validated statistical study — do not present them as such.
const CONFIDENCE_THRESHOLDS_KM = {
  HIGH: 2,
  MEDIUM: 5,
  LOW: 15,
  // beyond LOW: no match (treated as NONE)
};

function confidenceForDistance(distanceKm) {
  if (distanceKm <= CONFIDENCE_THRESHOLDS_KM.HIGH) return 'HIGH';
  if (distanceKm <= CONFIDENCE_THRESHOLDS_KM.MEDIUM) return 'MEDIUM';
  if (distanceKm <= CONFIDENCE_THRESHOLDS_KM.LOW) return 'LOW';
  return 'NONE';
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Real geospatial nearest-road query using MongoDB's $near operator
 * against the 2dsphere index on `geometry`. Requires the index to exist
 * (see Road.js schema) and the road to actually have geometry stored.
 * Returns null if no geometry-bearing road exists within the LOW
 * confidence threshold, or if the query fails for any reason (e.g. no
 * 2dsphere index yet on an old/unmigrated database) — callers should
 * treat null as "try the point-based fallback".
 */
async function findNearestRoadGeo(lat, lng) {
  try {
    const maxDistanceMeters = CONFIDENCE_THRESHOLDS_KM.LOW * 1000;
    const roads = await Road.find({
      geometry: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: maxDistanceMeters,
        },
      },
    }).limit(1);

    if (!roads.length) return null;

    const road = roads[0];
    // $near already sorted by distance but doesn't return the distance
    // value itself, so recompute it against the midpoint for reporting.
    // (Good enough for confidence tiering — exact point-to-line distance
    // is what $near used internally to select this road.)
    const distanceKm = haversineKm(lat, lng, road.lat, road.lng);

    return {
      road,
      distanceKm: Math.round(distanceKm * 10) / 10,
      confidence: confidenceForDistance(distanceKm),
      method: 'GEOSPATIAL',
    };
  } catch (err) {
    // No 2dsphere index, no geometry-bearing roads, or a query error —
    // let the caller fall back to the point-based method.
    return null;
  }
}

/**
 * Original Phase-0 fallback: straight-line distance to each road's
 * lat/lng point. Used when no geometry-based match is found (e.g. the
 * screening-demo's prototype roads, which have no `geometry` field).
 */
async function findNearestRoadPoint(lat, lng) {
  const roads = await Road.find({ lat: { $ne: null }, lng: { $ne: null } }).lean();
  if (!roads.length) return null;

  let nearest = null;
  let nearestDist = Infinity;

  for (const road of roads) {
    const dist = haversineKm(lat, lng, road.lat, road.lng);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = road;
    }
  }

  if (!nearest) return null;

  return {
    road: nearest,
    distanceKm: Math.round(nearestDist * 10) / 10,
    confidence: confidenceForDistance(nearestDist),
    method: 'POINT_FALLBACK',
  };
}

/**
 * Combined entry point used by incidentController. Tries the real
 * geospatial query first; falls back to the point comparison if that
 * finds nothing.
 */
async function findNearestRoad(lat, lng) {
  const geoResult = await findNearestRoadGeo(lat, lng);
  if (geoResult) return geoResult;
  return findNearestRoadPoint(lat, lng);
}

module.exports = {
  findNearestRoad,
  findNearestRoadGeo,
  findNearestRoadPoint,
  confidenceForDistance,
  haversineKm,
  CONFIDENCE_THRESHOLDS_KM,
};
