const Shipment = require('../models/Shipment');
const { success, failure } = require('../utils/response');
const { isValidEnumValue } = require('../utils/validators');

// GET /api/shipments
async function getShipments(req, res) {
  const shipments = await Shipment.find().sort({ createdAt: -1 });
  return success(res, shipments);
}

// GET /api/shipments/:id
async function getShipmentById(req, res) {
  const shipment = await Shipment.findById(req.params.id);
  if (!shipment) return failure(res, 'Shipment not found', 404);
  return success(res, shipment);
}

// POST /api/shipments
async function createShipment(req, res) {
  const { cargo, priority, origin, destination, vehicleId, status } = req.body;

  if (!cargo || !origin || !destination) {
    return failure(res, 'cargo, origin, and destination are required', 422);
  }
  if (priority !== undefined && !isValidEnumValue(Shipment, 'priority', priority)) {
    return failure(res, `priority must be one of ${Shipment.schema.path('priority').enumValues.join(', ')}`, 422);
  }
  if (status !== undefined && !isValidEnumValue(Shipment, 'status', status)) {
    return failure(res, `status must be one of ${Shipment.schema.path('status').enumValues.join(', ')}`, 422);
  }

  const shipment = await Shipment.create({
    cargo,
    priority,
    origin,
    destination,
    vehicleId: vehicleId || null,
    status,
  });

  return success(res, shipment, 201);
}

module.exports = { getShipments, getShipmentById, createShipment };
