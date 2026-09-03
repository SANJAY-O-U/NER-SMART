const mongoose = require('mongoose');

const IncidentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['LANDSLIDE', 'FLOOD', 'ROAD_DAMAGE', 'ACCIDENT', 'OTHER'],
      required: true,
    },
    severity: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH'],
      default: 'MEDIUM',
    },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    description: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

IncidentSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

module.exports = mongoose.model('Incident', IncidentSchema);
