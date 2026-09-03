const mongoose = require('mongoose');

const ShipmentSchema = new mongoose.Schema(
  {
    cargo: { type: String, required: true },
    priority: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'MEDIUM',
    },
    origin: { type: String, required: true },
    destination: { type: String, required: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle', default: null },
    route: {
      recommendedRoute: { type: String, default: null },
      roadName: { type: String, default: null },
      distance: { type: Number, default: null },
      eta: { type: String, default: null },
      risk: { type: Number, default: null },
      delay: { type: String, default: null },
      reason: { type: String, default: null },
    },
    status: {
      type: String,
      enum: ['PENDING', 'IN_TRANSIT', 'DELAYED', 'REROUTED', 'DELIVERED'],
      default: 'PENDING',
    },
  },
  { timestamps: true }
);

ShipmentSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

module.exports = mongoose.model('Shipment', ShipmentSchema);
