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
 */
async function computeAccessibilityForRoad(roadId) {
  const road = await Road.findById(roadId);
  if (!road) return null;

  const now = new Date();

  const [alerts, incidents, weatherMatch] = await Promise.all([
    DisasterAlert.find({ affectedRoadIds: road._id, lifecycleStatus: { $in: ['ACTIVE', 'UPDATED'] } }),
    Incident.find({ roadId: road._id }).sort({ timestamp: -1 }).limit(10),
    findWeatherForRoad(road).catch(() => null), // weather is always UNAVAILABLE (IMD_ACCESS=NOT_VERIFIED) — never let it break accessibility
  ]);

  const evidence = [
    ...buildRoadStatusEvidence(road),
    ...buildDisasterEvidence(alerts, computeDisasterRiskContribution, now),
    ...buildWeatherEvidence(weatherMatch, extractRiskFeaturesFromWeather),
    ...buildIncidentEvidence(incidents),
  ];

  const result = computeAccessibilityFromEvidence(evidence, { now });

  return {
    roadId: road.id,
    roadName: road.name,
    ...result,
  };
}

module.exports = { computeAccessibilityForRoad };
