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
    // Phase 6B: explicit provenance for HOW the road was matched, and
    // WHEN — never invented, only set once a real association attempt
    // ran (even if it found nothing).
    associationMethod: {
      type: String,
      enum: ['MONGODB_2DSPHERE_GPS_AWARE', 'MONGODB_2DSPHERE_DISTANCE_ONLY', null],
      default: null,
    },
    associationTimestamp: { type: Date, default: null },
    // Phase 6D: set only when status transitions to RESOLVED — never
    // backfilled or guessed for historical incidents.
    resolvedAt: { type: Date, default: null },
    reportedBy: { type: String, default: null }, // driver name/id, optional
    // Phase 5: idempotency key for offline-first field submissions. Sparse
    // unique index — most incidents (SIMULATION/AUTHORITY-sourced, or older
    // DRIVER_APP ones from before Phase 5) have no clientEventId at all,
    // and that must remain valid. Only enforced unique when present.
    clientEventId: { type: String, default: null },
    // Phase 4A: which location mode the driver app used for this report.
    // Never inferred — only set when the client explicitly sends it.
    locationMode: { type: String, enum: ['LIVE_GPS', 'NER_DEMO', null], default: null },
    gpsAccuracyMeters: { type: Number, default: null },
    // Phase 5: AI ASSISTANCE only — classification/summarization to help an
    // operator triage, never authoritative. `severity` here is a hint and
    // is deliberately never copied onto the top-level `severity` field
    // above (which stays driver-submitted-or-default) and is never read by
    // the deterministic accessibility engine — see accessibilityEvidence.js.
    aiResult: {
      classification: { type: String, default: null },
      severity: { type: String, default: null }, // AI's own LOW/MEDIUM/HIGH read — a hint, never authoritative
      confidence: { type: Number, default: null }, // 0-1, AI's own confidence — never accessibility confidence
      summary: { type: String, default: null },
      rationale: { type: String, default: null }, // short explanation of why this classification was reached
      model: { type: String, default: null }, // e.g. 'heuristic-keyword-v1' or the real model id used
      generatedAt: { type: Date, default: null },
      source: { type: String, enum: ['REAL_AI', 'DEMO_FALLBACK', null], default: null },
    },
  },
  { timestamps: true }
);

IncidentSchema.index(
  { clientEventId: 1 },
  { unique: true, partialFilterExpression: { clientEventId: { $type: 'string' } } }
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
