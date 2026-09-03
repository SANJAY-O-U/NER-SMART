const mongoose = require('mongoose');

const VehicleSchema = new mongoose.Schema(
  {
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', default: null },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    speed: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['IDLE', 'IN_TRANSIT', 'DELAYED', 'STOPPED'],
      default: 'IDLE',
    },
  },
  { timestamps: true }
);

VehicleSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

module.exports = mongoose.model('Vehicle', VehicleSchema);
