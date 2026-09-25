const Road = require('../models/Road');
const Shipment = require('../models/Shipment');
const { escalateLandslideRisk } = require('../services/riskService');
const { recommendRoute } = require('../services/routingService');
const { createAlert } = require('../services/alertService');
const { success, failure } = require('../utils/response');
const { isDemoResetAllowed } = require('./demoController');
const { isValidObjectId } = require('../utils/validators');

// POST /api/simulation/landslide
// Body: { roadId } - the road to mark as blocked / hit by the landslide
//
// Phase 1 hardening: this endpoint used to have NO safety guard at all —
// a single unauthenticated request against a real imported road's id
// would permanently set its status to BLOCKED in the live database, even
// though the dashboard labels the trigger button "WHAT-IF / DEMO". Two
// guards now apply, reusing the SAME allowlist predicate
// demoController.js already uses for /api/demo/reset rather than
// inventing a separate mechanism:
//
//   1. The endpoint is unavailable at all unless APP_MODE is exactly
//      'demo' (isDemoResetAllowed) — mirrors resetDemo's own guard.
//   2. Even in demo mode, the targeted road must itself be demo data
//      (Road.source === null — the same field runSeed() already uses to
//      distinguish demo/prototype roads from real imported ones, see
//      seed.js's `Road.deleteMany({ source: null })`). A demo-mode
//      simulation can never silently mutate a real imported NH 27/29/2
//      road.
/**
 * Pure predicate — the exact same "is this demo data" check runSeed()
 * already applies to decide which roads its own cleanup may delete
 * (`seed.js`'s `Road.deleteMany({ source: null })`). Exported for direct
 * unit testing against a plain object, without a Mongoose document or DB
 * connection.
 */
function isRoadEligibleForSimulation(road) {
  return Boolean(road) && road.source === null;
}

async function simulateLandslide(req, res) {
  if (!isDemoResetAllowed(process.env.APP_MODE)) {
    return failure(
      res,
      `Landslide simulation is only available when APP_MODE=demo (current: ${process.env.APP_MODE || 'unset'}). This is a safety guard, not a bug.`,
      403
    );
  }

  const { roadId } = req.body;

  if (!roadId) {
    return failure(res, 'roadId is required', 422);
  }
  if (!isValidObjectId(roadId)) {
    return failure(res, 'roadId must be a valid id', 422);
  }

  const road = await Road.findById(roadId);
  if (!road) return failure(res, 'Road not found', 404);

  if (!isRoadEligibleForSimulation(road)) {
    return failure(
      res,
      'Landslide simulation can only target demo/prototype roads (source: null) — this road is real imported data and was not modified.',
      403
    );
  }

  // 1. Mark selected road as BLOCKED
  // 2. Increase its landslide risk
  road.status = 'BLOCKED';
  road.landslideRisk = escalateLandslideRisk(road.landslideRisk, 40);
  await road.save();

  // 3. Find affected shipments (shipments currently routed over this road)
  const affectedShipments = await Shipment.find({ 'route.roadName': road.name });

  let newRouteName = null;
  let alertsCreated = 0;

  // 4 & 5. Calculate alternate route and update each affected shipment
  for (const shipment of affectedShipments) {
    const newRoute = recommendRoute({
      origin: shipment.origin,
      destination: shipment.destination,
      shipmentPriority: shipment.priority,
      excludeRoadNames: [road.name],
    });

    shipment.route = {
      recommendedRoute: newRoute.recommendedRoute,
      roadName: newRoute.roadName,
      distance: newRoute.distance,
      eta: newRoute.eta,
      risk: newRoute.risk,
      delay: newRoute.delay,
      reason: newRoute.reason,
    };
    shipment.status = 'REROUTED';
    await shipment.save();

    newRouteName = newRoute.recommendedRoute;

    // 6. Generate alerts
    await createAlert({
      type: 'REROUTE',
      severity: 'HIGH',
      shipmentId: shipment._id,
      message: `${road.name} blocked by landslide. Shipment "${shipment.cargo}" rerouted to ${newRoute.recommendedRoute}.`,
    });
    alertsCreated += 1;
  }

  // If nothing was affected, still surface a general alert about the block.
  if (affectedShipments.length === 0) {
    await createAlert({
      type: 'ROAD_BLOCKED',
      severity: 'HIGH',
      message: `${road.name} has been blocked by a simulated landslide.`,
    });
    alertsCreated += 1;
  }

  // 7. Return summary
  return success(res, {
    roadStatus: road.status,
    affectedShipments: affectedShipments.length,
    newRoute: newRouteName,
    alertsCreated,
  });
}

module.exports = { simulateLandslide, isRoadEligibleForSimulation };
