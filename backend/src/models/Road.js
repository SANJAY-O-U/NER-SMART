const mongoose = require('mongoose');

const RoadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ['OPEN', 'BLOCKED', 'RESTRICTED'],
      default: 'OPEN',
    },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    floodRisk: { type: Number, default: 0, min: 0, max: 100 },
    landslideRisk: { type: Number, default: 0, min: 0, max: 100 },
  },
  { timestamps: true }
);

RoadSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

module.exports = mongoose.model('Road', RoadSchema);
