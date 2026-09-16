/**
 * SACHET -> Road Association
 * ---------------------------
 * District-level only. SACHET's polygon endpoint is blocked (Phase 3A) —
 * so a road is associated with an alert if the road's (approximate)
 * district matches one of the alert's matched districts. This is
 * DISTRICT_LEVEL_ASSOCIATION, never PRECISE_HAZARD_BOUNDARY, and it
 * NEVER implies the road is closed — only that it sits in a district
 * under an active hazard alert.
 */

const Road = require('../models/Road');

/**
 * @param {object} alert - a normalized DisasterAlert-shaped object with
 *   `matchedDistricts: [{name, state, lgdCode, matchMethod}]`
 * @returns {Promise<{affectedRoadIds, associationMethod, associationConfidence, matchedRoadCount}>}
 */
async function associateAlertWithRoads(alert) {
  const districtNames = (alert.matchedDistricts || []).map((d) => d.name);

  if (districtNames.length === 0) {
    return {
      affectedRoadIds: [],
      associationMethod: null,
      associationConfidence: null,
      matchedRoadCount: 0,
    };
  }

  const roads = await Road.find({ district: { $in: districtNames } }).select('_id district districtAssignmentMethod');

  if (!roads.length) {
    return {
      affectedRoadIds: [],
      associationMethod: null,
      associationConfidence: null,
      matchedRoadCount: 0,
    };
  }

  // Confidence reflects how the ROAD's district was determined, not how
  // the alert's district was matched — the weaker of the two link's
  // precision is what should be trusted. Every road in our current
  // dataset carries districtAssignmentMethod = NEAREST_DISTRICT_HQ_APPROXIMATION
  // (see backfillRoadDistricts.js) — a future boundary-join road would
  // get HIGH here automatically once such roads exist.
  const anyApproximate = roads.some((r) => r.districtAssignmentMethod === 'NEAREST_DISTRICT_HQ_APPROXIMATION');
  const associationConfidence = anyApproximate ? 'MEDIUM' : 'HIGH';

  return {
    affectedRoadIds: roads.map((r) => r._id),
    associationMethod: anyApproximate ? 'NEAREST_DISTRICT_HQ_APPROXIMATION' : 'LGD_DISTRICT_MATCH',
    associationConfidence,
    matchedRoadCount: roads.length,
  };
}

module.exports = { associateAlertWithRoads };
