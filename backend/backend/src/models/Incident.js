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

    // --- NER-SMART driver-report extension (P0) ---
    // Backward compatible: all new fields have safe defaults so existing
    // seed data / simulation-created incidents keep working unchanged.
    status: {
      type: String,
      enum: ['REPORTED', 'AI_ANALYSED', 'VERIFIED', 'ACTION_REQUIRED', 'RESOLVED'],
      default: 'REPORTED',
    },
    source: {
      type: String,
      enum: ['DRIVER_APP', 'SIMULATION', 'AUTHORITY'],
      default: 'SIMULATION',
    },
    roadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Road', default: null },
    roadName: { type: String, default: null },
    // Phase 1: exposed separately so the dashboard can show match quality
    // instead of silently implying a certain association. roadId/roadName
    // above are only set when confidence is HIGH or MEDIUM — see
    // incidentController.js.
    distanceToRoadKm: { type: Number, default: null },
    roadMatchConfidence: {
      type: String,
      enum: ['HIGH', 'MEDIUM', 'LOW', 'NONE', null],
      default: null,
    },
    reportedBy: { type: String, default: null }, // driver name/id, optional
    // Phase 4A: which location mode the driver app used for this report.
    // Never inferred — only set when the client explicitly sends it.
    locationMode: { type: String, enum: ['LIVE_GPS', 'NER_DEMO', null], default: null },
    gpsAccuracyMeters: { type: Number, default: null },
    aiResult: {
      classification: { type: String, default: null },
      severity: { type: String, default: null }, // AI's own LOW/MEDIUM/HIGH read, may refine `severity`
      confidence: { type: Number, default: null }, // 0-1
      summary: { type: String, default: null },
      source: { type: String, enum: ['REAL_AI', 'DEMO_FALLBACK', null], default: null },
    },
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
