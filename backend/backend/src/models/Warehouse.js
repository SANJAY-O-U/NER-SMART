const mongoose = require('mongoose');

/**
 * Not part of the core API contract — used only as reference/map data
 * seeded alongside the core entities (per hackathon seed requirements).
 */
const WarehouseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    capacity: { type: Number, default: 100 },
  },
  { timestamps: true }
);

WarehouseSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

module.exports = mongoose.model('Warehouse', WarehouseSchema);
