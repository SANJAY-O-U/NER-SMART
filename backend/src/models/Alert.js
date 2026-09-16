const mongoose = require('mongoose');

const AlertSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['REROUTE', 'RISK_WARNING', 'ROAD_BLOCKED', 'DELAY', 'GENERAL'],
      default: 'GENERAL',
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      default: 'MEDIUM',
    },
    message: { type: String, required: true },
    shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', default: null },
    // Phase 6G: provenance for closed-loop alerts (field incident ->
    // accessibility change -> alert). Optional/backward compatible —
    // existing simulation-generated alerts have none of these set.
    source: { type: String, enum: ['SIMULATION', 'FIELD_INCIDENT', 'DISASTER_ALERT', null], default: null },
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', default: null },
    roadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Road', default: null },
    triggerReason: { type: String, default: null },
    generatedAt: { type: Date, default: Date.now },
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

AlertSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

module.exports = mongoose.model('Alert', AlertSchema);
