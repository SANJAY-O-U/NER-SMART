const Incident = require('../models/Incident');
const Road = require('../models/Road');
const Alert = require('../models/Alert');
const { success, failure } = require('../utils/response');
const { computeAccessibilityForRoad } = require('../services/accessibilityService');

// GET /api/incidents/:id/impact
//
// Phase 6J: a single read-only endpoint exposing the full closed-loop
// chain for one incident — incident -> affected road -> current
// accessibility/evidence -> any alert(s) this incident's provenance is
// attached to. Composes EXISTING services (no new calculation logic);
// returns null for any link that doesn't apply rather than fabricating one.
async function getIncidentImpact(req, res) {
  const incident = await Incident.findById(req.params.id);
  if (!incident) return failure(res, 'Incident not found', 404);

  let road = null;
  let accessibility = null;
  let counterfactualBefore = null;
  if (incident.roadId) {
    road = await Road.findById(incident.roadId);
    accessibility = await computeAccessibilityForRoad(incident.roadId);
    // Phase 6H: reconstruct an honest "before" by recomputing WITHOUT
    // this incident's own evidence — lets the dashboard show a genuine
    // before/after even when viewed well after creation, without
    // persisting a duplicate snapshot anywhere.
    counterfactualBefore = await computeAccessibilityForRoad(incident.roadId, { excludeIncidentId: incident._id });
  }

  // Alerts whose provenance names this incident — real query, not a
  // recomputation. Route impact is not queried here: the routing engine
  // (Phase 4C) is computed per-request for a given origin/destination,
  // not stored per-road, so there is no "the route impact" for an
  // incident in isolation — see ROUTING_ARCHITECTURE.md. Exposed as null
  // with an explanatory note rather than fabricated.
  const alerts = await Alert.find({ incidentId: incident._id }).sort({ generatedAt: -1 });

  return success(res, {
    incident,
    road,
    accessibility,
    accessibilityWithoutThisIncident: counterfactualBefore,
    alerts,
    routeImpact: null,
    routeImpactNote:
      'Route impact is computed per-request for a specific origin/destination (POST /api/routes/recommend-real), not stored per-incident. Recompute a route through this road to see current impact.',
  });
}

module.exports = { getIncidentImpact };
