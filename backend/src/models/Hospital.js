const mongoose = require('mongoose');

/**
 * Not part of the core API contract — used only as reference/map data
 * seeded alongside the core entities (per hackathon seed requirements).
 */
const HospitalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    emergencyCapable: { type: Boolean, default: true },
  },
  { timestamps: true }
);

HospitalSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

module.exports = mongoose.model('Hospital', HospitalSchema);
