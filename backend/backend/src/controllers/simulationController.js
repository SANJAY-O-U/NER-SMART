const Road = require('../models/Road');
const Shipment = require('../models/Shipment');
const { escalateLandslideRisk } = require('../services/riskService');
const { recommendRoute } = require('../services/routingService');
const { createAlert } = require('../services/alertService');
const { success, failure } = require('../utils/response');

// POST /api/simulation/landslide
// Body: { roadId } - the road to mark as blocked / hit by the landslide
async function simulateLandslide(req, res) {
  const { roadId } = req.body;

  if (!roadId) {
    return failure(res, 'roadId is required', 422);
  }

  const road = await Road.findById(roadId);
  if (!road) return failure(res, 'Road not found', 404);

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

module.exports = { simulateLandslide };
