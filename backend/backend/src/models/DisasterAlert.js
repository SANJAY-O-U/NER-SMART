const mongoose = require('mongoose');

/**
 * DisasterAlert
 * -------------
 * Normalized representation of an NDMA SACHET CAP 1.2 alert. Fields
 * mirror the real CAP structure observed live during Phase 3A
 * (sachet.ndma.gov.in/cap_public_website/FetchXMLFile) — nothing here
 * was invented; a field is null if CAP didn't provide it for that alert.
 */
const DisasterAlertSchema = new mongoose.Schema(
  {
    // CAP identity/routing — cap:identifier is the primary dedupe key.
    identifier: { type: String, required: true, unique: true }, // e.g. "IN-1789459976634025_44"
    rssGuid: { type: String, default: null }, // the numeric id used in FetchXMLFile?identifier=
    sender: { type: String, default: null }, // e.g. "IMD-Guwahati"
    sent: { type: Date, default: null },
    status: { type: String, default: null }, // CAP status: Actual / Exercise / System / Test / Draft
    msgType: { type: String, default: null }, // Alert / Update / Cancel / Ack / Error

    // CAP info block
    category: { type: String, default: null }, // e.g. "Met"
    event: { type: String, default: null },
    urgency: { type: String, default: null }, // Immediate/Expected/Future/Past/Unknown
    severity: { type: String, default: null }, // Extreme/Severe/Moderate/Minor/Unknown
    certainty: { type: String, default: null }, // Observed/Likely/Possible/Unlikely/Unknown
    effective: { type: Date, default: null },
    onset: { type: Date, default: null },
    expires: { type: Date, default: null },
    headline: { type: String, default: null },
    description: { type: String, default: null },
    instruction: { type: String, default: null },

    // Geography — district-level only (see association note below).
    areaDesc: { type: String, default: null },
    lgdDistrictCodes: { type: [Number], default: [] },
    matchedDistricts: [{ name: String, state: String, lgdCode: Number, matchMethod: String }],
    matchedStates: { type: [String], default: [] },
    // Deliberately null unless the (currently blocked) polygon endpoint
    // is independently verified — see DATA_PROVENANCE.md / Phase 3A audit.
    polygon: { type: mongoose.Schema.Types.Mixed, default: null },

    // Lifecycle
    lifecycleStatus: {
      type: String,
      enum: ['ACTIVE', 'EXPIRED', 'CANCELLED', 'UPDATED'],
      default: 'ACTIVE',
    },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    sourceUpdatedAt: { type: Date, default: null }, // = cap:sent of the most recent version processed

    // Road association (district-level — see sachetRoadAssociation.js)
    affectedRoadIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Road' }],
    associationMethod: {
      type: String,
      enum: ['LGD_DISTRICT_MATCH', 'AREADESC_TEXT_MATCH', 'NEAREST_DISTRICT_HQ_APPROXIMATION', null],
      default: null,
    },
    associationConfidence: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW', null], default: null },

    // Disaster risk contribution (see disasterRiskAdapter.js) — a
    // documented heuristic, never presented as ML/scientific accuracy.
    disasterRiskContribution: { type: Number, default: null }, // 0-100, same scale as riskService inputs

    // Provenance
    source: { type: String, default: 'NDMA_SACHET' },
    sourceUrl: { type: String, default: null }, // the FetchXMLFile URL used
    retrievedAt: { type: Date, default: Date.now },
    sourceStatus: {
      type: String,
      enum: ['LIVE', 'STALE', 'CACHED', 'UNAVAILABLE', 'DEMO'],
      default: 'LIVE',
    },

    rawCapXml: { type: String, default: null }, // kept for traceability/debugging, not for app logic
  },
  { timestamps: true }
);

DisasterAlertSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
  },
});

module.exports = mongoose.model('DisasterAlert', DisasterAlertSchema);
