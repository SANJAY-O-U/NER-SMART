const Vehicle = require('../models/Vehicle');
const { success, failure } = require('../utils/response');
const { isValidLat, isValidLng, isValidEnumValue, isValidObjectId } = require('../utils/validators');

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
  if (!isValidLat(Number(lat)) || !isValidLng(Number(lng))) {
    return failure(res, 'lat must be -90..90 and lng must be -180..180', 422);
  }
  if (vehicleId !== undefined && !isValidObjectId(vehicleId)) {
    return failure(res, 'vehicleId must be a valid id', 422);
  }
  if (status !== undefined && !isValidEnumValue(Vehicle, 'status', status)) {
    return failure(res, `status must be one of ${Vehicle.schema.path('status').enumValues.join(', ')}`, 422);
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
