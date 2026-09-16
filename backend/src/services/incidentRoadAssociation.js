/**
 * Incident -> Road Association (Phase 6B)
 * -----------------------------------------
 * Reuses the EXISTING real geospatial query (geoService.findNearestRoadGeo,
 * Phase 1's MongoDB 2dsphere lookup) and layers Phase 4A's GPS-accuracy-
 * aware confidence classification (locationMatchService) on top when the
 * incident actually has a gpsAccuracyMeters value (i.e. it came from the
 * field app's real device GPS). Falls back to the original km-scale,
 * distance-only confidence (geoService's own logic) when no accuracy is
 * known — e.g. SIMULATION-sourced incidents, or older DRIVER_APP
 * submissions from before GPS metadata was captured. Never invents a
 * roadId either way.
 */

const { findNearestRoadGeo } = require('./geoService');
const { classifyRoadMatchConfidence } = require('./locationMatchService');

/**
 * @param {object} params
 * @param {number} params.lat
 * @param {number} params.lng
 * @param {number|null} [params.gpsAccuracyMeters]
 * @param {Date} [params.now]
 * @returns {Promise<{road: object|null, distanceKm: number|null, roadMatchConfidence: string, associationMethod: string, associationTimestamp: Date}>}
 */
async function associateIncidentWithRoad({ lat, lng, gpsAccuracyMeters = null, now = new Date() }) {
  const geoResult = await findNearestRoadGeo(lat, lng);

  if (!geoResult) {
    return {
      road: null,
      distanceKm: null,
      roadMatchConfidence: 'NONE',
      associationMethod: gpsAccuracyMeters !== null ? 'MONGODB_2DSPHERE_GPS_AWARE' : 'MONGODB_2DSPHERE_DISTANCE_ONLY',
      associationTimestamp: now,
    };
  }

  let confidence;
  let method;

  if (typeof gpsAccuracyMeters === 'number') {
    // Real device GPS accuracy known — use the tighter, accuracy-aware
    // meter-scale classification from Phase 4A instead of the coarser
    // km-scale one, since we have strictly more information here.
    confidence = classifyRoadMatchConfidence({
      distanceMeters: geoResult.distanceKm * 1000,
      gpsAccuracyMeters,
    });
    // NONE from the accuracy-aware classifier means "not a safe match at
    // this precision" — distinct from geoService's own NONE (too far).
    if (confidence === 'NONE') confidence = 'LOW';
    method = 'MONGODB_2DSPHERE_GPS_AWARE';
  } else {
    confidence = geoResult.confidence; // geoService's own km-scale confidence, unchanged
    method = 'MONGODB_2DSPHERE_DISTANCE_ONLY';
  }

  return {
    road: geoResult.road,
    distanceKm: geoResult.distanceKm,
    roadMatchConfidence: confidence,
    associationMethod: method,
    associationTimestamp: now,
  };
}

module.exports = { associateIncidentWithRoad };
