const mongoose = require('mongoose');

/**
 * Road
 * ----
 * Backward compatible with the screening-demo shape: `name`, `status`,
 * `lat`, `lng`, `floodRisk`, `landslideRisk` all still work exactly as
 * before for prototype/demo roads that have no real geometry.
 *
 * Phase 1 adds a REAL geospatial foundation on top of that:
 *   - `geometry` (GeoJSON LineString/MultiLineString, 2dsphere-indexed)
 *   - source/provenance fields so imported data is traceable
 *   - a SEPARATE `physicalStatus`/`officialStatus`/`fieldStatus` trio
 *     that defaults to UNKNOWN — these are NOT the same as the existing
 *     `status` field, which remains the screening-demo's own
 *     OPEN/BLOCKED/RESTRICTED value used by the landslide simulation.
 *     We do not claim to know a real road's closure state just because
 *     we imported its geometry.
 *
 * For imported roads, `lat`/`lng` are set to the geometry's midpoint so
 * every existing consumer that only knows about lat/lng (risk engine,
 * routing demo catalogue, old RoadLayer marker fallback) keeps working
 * unchanged.
 */
const RoadSchema = new mongoose.Schema(
  {
    // ---- existing screening-demo fields (unchanged) ----
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ['OPEN', 'BLOCKED', 'RESTRICTED'],
      default: 'OPEN',
    },
    lat: { type: Number },
    lng: { type: Number },
    floodRisk: { type: Number, default: 0, min: 0, max: 100 },
    landslideRisk: { type: Number, default: 0, min: 0, max: 100 },

    // ---- Phase 1: real geospatial foundation ----
    geometry: {
      type: {
        type: String,
        enum: ['LineString', 'MultiLineString'],
      },
      coordinates: { type: mongoose.Schema.Types.Mixed }, // [[lng,lat],...] or [[[lng,lat],...]]
    },
    roadNumber: { type: String, default: null }, // e.g. "NH 27"
    highwayClass: { type: String, default: null }, // e.g. "National Highway"
    state: { type: String, default: null }, // null when source doesn't provide it — never guessed
    district: { type: String, default: null },
    districtAssignmentMethod: {
      type: String,
      enum: ['NEAREST_DISTRICT_HQ_APPROXIMATION', 'BOUNDARY_JOIN', null],
      default: null,
    },
    corridor: { type: String, default: null }, // e.g. "Guwahati-Imphal" — our own grouping, not from source

    // Provenance — required for every imported (non-demo) road.
    source: { type: String, default: null }, // e.g. "datta07/INDIAN-SHAPEFILES (MIT)"
    sourceId: { type: String, default: null }, // source's own feature id, for duplicate-safe re-import
    sourceVintage: { type: String, default: null }, // e.g. "circa 2019" — source's documented data vintage
    importedAt: { type: Date, default: null },
    lastVerifiedAt: { type: Date, default: null }, // null = never field-verified

    // Real-world status trio — intentionally separate from `status` above.
    // Default UNKNOWN because the imported dataset carries no closure
    // status at all; never inferred.
    physicalStatus: {
      type: String,
      enum: ['OPEN', 'RESTRICTED', 'HIGH_RISK', 'BLOCKED', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    officialStatus: {
      type: String,
      enum: ['OPEN', 'RESTRICTED', 'HIGH_RISK', 'BLOCKED', 'UNKNOWN'],
      default: 'UNKNOWN',
    },
    fieldStatus: {
      type: String,
      enum: ['OPEN', 'RESTRICTED', 'HIGH_RISK', 'BLOCKED', 'UNKNOWN'],
      default: 'UNKNOWN',
    },

    weatherRisk: { type: Number, default: null }, // 0-100, populated once weather ingestion exists (Phase 2)
    disasterRisk: { type: Number, default: null }, // 0-100, populated once alert ingestion exists (Phase 3)
    accessibilityScore: { type: Number, default: null }, // 0-1, populated once accessibility engine exists (Phase 7)
    geometryConfidence: { type: Number, default: null }, // 0-1, how confident we are in THIS geometry match/import

    // Raw source properties, kept for traceability/debugging — never
    // used directly to drive application logic.
    sourceProperties: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

RoadSchema.index({ geometry: '2dsphere' });

RoadSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

module.exports = mongoose.model('Road', RoadSchema);
