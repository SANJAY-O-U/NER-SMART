const Vehicle = require('../models/Vehicle');
const { success, failure } = require('../utils/response');

// GET /api/vehicles
async function getVehicles(req, res) {
  const vehicles = await Vehicle.find().sort({ updatedAt: -1 });
  return success(res, vehicles);
}

// POST /api/vehicles/location
// Body: { vehicleId, lat, lng, speed?, status? }
// Upserts a vehicle's live location (creates the vehicle if it doesn't exist yet).
async function updateVehicleLocation(req, res) {
  const { vehicleId, lat, lng, speed, status, shipmentId } = req.body;

  if (lat === undefined || lng === undefined) {
    return failure(res, 'lat and lng are required', 422);
  }

  let vehicle;

  if (vehicleId) {
    vehicle = await Vehicle.findByIdAndUpdate(
      vehicleId,
      { lat, lng, ...(speed !== undefined && { speed }), ...(status && { status }), ...(shipmentId !== undefined && { shipmentId }) },
      { new: true, upsert: false }
    );
    if (!vehicle) return failure(res, 'Vehicle not found', 404);
  } else {
    vehicle = await Vehicle.create({ lat, lng, speed, status, shipmentId });
  }

  return success(res, vehicle);
}

module.exports = { getVehicles, updateVehicleLocation };
