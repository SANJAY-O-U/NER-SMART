const mongoose = require('mongoose');

/**
 * WeatherObservation
 * -------------------
 * A normalized representation of a weather reading, independent of which
 * upstream API format it came from. Every field the source doesn't
 * actually provide stays `null` — never fabricated or estimated.
 *
 * Phase 2 note: as of this writing, NO live IMD data has ever been
 * written to this collection (IMD_ACCESS = NOT_VERIFIED — see
 * IMD_INTEGRATION.md). The model, validation, and normalization pipeline
 * are built and unit-tested against IMD's documented response formats,
 * ready to receive real data the moment credentials exist.
 */
const WeatherObservationSchema = new mongoose.Schema(
  {
    source: { type: String, required: true }, // e.g. "IMD_CURRENT_WX", "IMD_AWS"
    sourceRecordId: { type: String, default: null }, // e.g. IMD station ID
    sourceStatus: {
      type: String,
      enum: ['LIVE', 'STALE', 'CACHED', 'UNAVAILABLE', 'DEMO'],
      required: true,
    },

    observedAt: { type: Date, default: null }, // when IMD says the reading was taken
    receivedAt: { type: Date, required: true, default: Date.now }, // when we fetched it
    validUntil: { type: Date, default: null }, // for forecasts/warnings; null for point observations

    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: null }, // [lng, lat]
    },
    state: { type: String, default: null },
    district: { type: String, default: null },
    stationName: { type: String, default: null },

    temperatureC: { type: Number, default: null },
    humidityPct: { type: Number, default: null },
    rainfallMm: { type: Number, default: null }, // last 24hr, per IMD current_wx field
    rainfallIntensity: { type: String, default: null }, // qualitative, only if source provides it
    windSpeedKmph: { type: Number, default: null },
    windDirectionDeg: { type: Number, default: null },
    visibility: { type: Number, default: null }, // only set if source provides it — IMD current_wx does not
    weatherCondition: { type: String, default: null }, // decoded from IMD weather code, kept human-readable
    warningLevel: { type: String, default: null }, // from district/subdivision warning APIs

    confidence: { type: Number, default: null }, // 0-1
    rawSourceRecord: { type: mongoose.Schema.Types.Mixed, default: null }, // original payload, for traceability
  },
  { timestamps: true }
);

WeatherObservationSchema.index({ location: '2dsphere' });
// Idempotency: the same station reading fetched twice should not duplicate.
WeatherObservationSchema.index(
  { source: 1, sourceRecordId: 1, observedAt: 1 },
  { unique: true, partialFilterExpression: { sourceRecordId: { $type: 'string' } } }
);

WeatherObservationSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

module.exports = mongoose.model('WeatherObservation', WeatherObservationSchema);
