/**
 * Location Match Service
 * -----------------------
 * Confidence logic for matching a live GPS point to a real road, used by
 * GET /api/roads/nearest (Phase 4A). Kept separate from geoService.js
 * (Phase 1's incident->road bridge, which uses kilometer-scale
 * thresholds appropriate for a driver's *reported* location) because
 * live GPS matching implies much tighter real-time precision
 * expectations — meter-scale, not kilometer-scale.
 *
 * Confidence is the WEAKEST LINK of two independent quantities:
 *   - how far the matched road is from the GPS point (distanceMeters)
 *   - how accurate the GPS fix itself is (gpsAccuracyMeters)
 * A tiny road distance with a huge GPS accuracy circle is NOT a
 * confident match — the mission is explicit about this (8m accuracy +
 * 4m road distance = HIGH; 150m accuracy + 5m road distance must NOT be
 * HIGH). All thresholds below are documented engineering defaults, not
 * a scientific/statistical claim.
 */

// Road-distance tiers, meters. Tighter than geoService's km-scale
// thresholds because a live GPS fix implies real-time precision, unlike
// a driver's manually-reported incident location.
const ROAD_DISTANCE_THRESHOLDS_M = {
  HIGH: 50,
  MEDIUM: 300,
  LOW: 15000, // matches geoService's existing LOW threshold (15km) for consistency
};

// GPS accuracy tiers, meters — per the mission's example values.
const GPS_ACCURACY_THRESHOLDS_M = {
  HIGH: 20,
  MEDIUM: 100,
  // LOW: anything above 100m
};

const TIER_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1, NONE: 0 };

function classifyByThreshold(value, thresholds) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value <= thresholds.HIGH) return 'HIGH';
  if (value <= thresholds.MEDIUM) return 'MEDIUM';
  if (thresholds.LOW !== undefined && value <= thresholds.LOW) return 'LOW';
  return thresholds.LOW !== undefined ? 'NONE' : 'LOW';
}

/** GPS accuracy alone -> quality tier. Never LOW just because it's missing — missing is a separate case (null). */
function classifyGpsQuality(accuracyMeters) {
  if (accuracyMeters === null || accuracyMeters === undefined || !Number.isFinite(accuracyMeters)) return null;
  if (accuracyMeters <= GPS_ACCURACY_THRESHOLDS_M.HIGH) return 'HIGH';
  if (accuracyMeters <= GPS_ACCURACY_THRESHOLDS_M.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

/** Road distance alone -> match tier, or NONE beyond the LOW threshold (no safe match). */
function classifyRoadDistance(distanceMeters) {
  return classifyByThreshold(distanceMeters, ROAD_DISTANCE_THRESHOLDS_M);
}

/**
 * Combined confidence: the weaker of the two tiers. If GPS accuracy
 * wasn't supplied, confidence is capped at MEDIUM — without knowing how
 * accurate the fix is, we cannot honestly call a match HIGH confidence
 * even if the road distance alone looks tiny.
 */
function classifyRoadMatchConfidence({ distanceMeters, gpsAccuracyMeters }) {
  const distanceTier = classifyRoadDistance(distanceMeters);
  if (!distanceTier || distanceTier === 'NONE') return 'NONE';

  const gpsTier = classifyGpsQuality(gpsAccuracyMeters);
  if (!gpsTier) {
    // No accuracy supplied — cap at MEDIUM regardless of how close the road is.
    return TIER_RANK[distanceTier] >= TIER_RANK.MEDIUM ? 'MEDIUM' : distanceTier;
  }

  const weaker = TIER_RANK[distanceTier] <= TIER_RANK[gpsTier] ? distanceTier : gpsTier;
  return weaker;
}

module.exports = {
  classifyGpsQuality,
  classifyRoadDistance,
  classifyRoadMatchConfidence,
  ROAD_DISTANCE_THRESHOLDS_M,
  GPS_ACCURACY_THRESHOLDS_M,
};
