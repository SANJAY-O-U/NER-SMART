/**
 * Accessibility Service
 * ----------------------
 * Thin orchestration layer: fetches real evidence from the EXISTING
 * data sources (no rewrites — Phase 1 Road status, Phase 2 weather,
 * Phase 3B SACHET, Phase 4A GPS-matched incidents) and hands it to the
 * pure accessibilityEngine.js for the actual decision. Kept deliberately
 * thin so the decision logic itself stays in the fully-testable pure
 * module.
 */

const Road = require('../models/Road');
const DisasterAlert = require('../models/DisasterAlert');
const Incident = require('../models/Incident');
const { findWeatherForRoad } = require('./weatherRoadService');
const { extractRiskFeaturesFromWeather } = require('./weatherRiskAdapter');
const { computeDisasterRiskContribution } = require('./disasterRiskAdapter');
const { computeAccessibilityFromEvidence } = require('./accessibilityEngine');
const { classifyIncidentFreshness } = require('./incidentFreshnessService');
const { classifyFreshness } = require('./freshnessService');
const {
  buildRoadStatusEvidence,
  buildDisasterEvidence,
  buildWeatherEvidence,
  buildIncidentEvidence,
} = require('./accessibilityEvidence');

/**
 * Computes accessibility for one road, gathering evidence from every
 * existing source. Callers should call this per-road, on demand
 * (GET /api/roads/:id/accessibility), not in a batch loop over the
 * whole network, per the mission's performance guidance for this phase.
 *
 * @param {string} roadId
 * @param {object} [options]
 * @param {string} [options.excludeIncidentId] - Phase 6: when set, computes
 *   a COUNTERFACTUAL accessibility that excludes one specific incident's
 *   evidence — used to reconstruct an honest "before" snapshot for a
 *   road's current incidents after the fact (GET /api/incidents/:id/impact),
 *   without duplicating this function's logic elsewhere.
 */
async function computeAccessibilityForRoad(roadId, { excludeIncidentId = null } = {}) {
  const road = await Road.findById(roadId);
  if (!road) return null;

  const now = new Date();

  const incidentQuery = { roadId: road._id };
  if (excludeIncidentId) incidentQuery._id = { $ne: excludeIncidentId };

  const [alerts, incidents, weatherMatch] = await Promise.all([
    DisasterAlert.find({ affectedRoadIds: road._id, lifecycleStatus: { $in: ['ACTIVE', 'UPDATED'] } }),
    Incident.find(incidentQuery).sort({ timestamp: -1 }).limit(10),
    findWeatherForRoad(road).catch(() => null), // never let a weather lookup failure break accessibility, regardless of which provider is active
  ]);

  const evidence = [
    ...buildRoadStatusEvidence(road),
    ...buildDisasterEvidence(alerts, computeDisasterRiskContribution, now),
    ...buildWeatherEvidence(weatherMatch, extractRiskFeaturesFromWeather, { now, classifyFreshness }),
    ...buildIncidentEvidence(incidents, { now, classifyIncidentFreshness }),
  ];

  const result = computeAccessibilityFromEvidence(evidence, { now });

  return {
    roadId: road.id,
    roadName: road.name,
    ...result,
  };
}

module.exports = { computeAccessibilityForRoad };
