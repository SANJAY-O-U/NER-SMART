const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Phase 11.2 — I5: partial incident creation / interrupted incident lifecycle.
//
// History: the first version of this file (Phase 11.1) CHARACTERIZED four defects of
// POST /api/incidents when a step after the raw report was persisted failed:
//   1. a retry of an incomplete REPORTED incident came back as a 200 "replay" and was
//      never completed (the driver app treats any 2xx as synced);
//   2. computed work (AI result, road match) was discarded when a later step failed;
//   3. a failure of the recompute/alert step left the road changed but the alert lost,
//      and no retry could create it;
//   4. nothing prevented two concurrent retries from running the pipeline twice.
// This version verifies the REMEDIATION (resumable, checkpointed, claim-guarded
// processing — see the block comment in controllers/incidentController.js).
//
// Harness (existing seam S4): the real createIncident controller, accessibilityService,
// accessibilityEvidence, accessibilityEngine, alertTriggerService and alertService all
// run; only the edges are stubbed (AI call, geo road lookup, weather lookup, MongoDB
// model I/O via an in-memory store whose findOneAndUpdate/updateOne evaluate the exact
// filters the controller sends). Requests go through the REAL asyncHandler and the REAL
// errorHandler so the HTTP status is what the server would produce.

mongoose.set('bufferCommands', false); // any un-stubbed DB call fails fast instead of hanging
process.env.NODE_ENV = 'production'; // errorHandler sanitizes 5xx exactly as in production
console.error = () => {}; // errorHandler logs the stack of every injected failure; keep output clean

// Stubs must be installed BEFORE the controller destructures them.
const aiService = require('../src/services/aiService');
const incidentRoadAssociation = require('../src/services/incidentRoadAssociation');
const weatherRoadService = require('../src/services/weatherRoadService');
const accessibilityService = require('../src/services/accessibilityService');
const riskService = require('../src/services/riskService');

const calls = {}; // per-test counters of what actually ran
const inject = {}; // per-test failure / timing injection
let nextAi;

weatherRoadService.findWeatherForRoad = async () => null;

aiService.analyzeIncident = async () => {
  calls.ai += 1;
  if (inject.aiGateOnce) {
    const gate = inject.aiGateOnce;
    inject.aiGateOnce = null; // only the first caller is held
    await gate;
  }
  if (inject.ai) throw new Error('simulated AI failure');
  return { ...nextAi, generatedAt: new Date() };
};

const Road = require('../src/models/Road');
const Incident = require('../src/models/Incident');
const DisasterAlert = require('../src/models/DisasterAlert');
const Alert = require('../src/models/Alert');

const road = new Road({ name: 'NH 27' });
incidentRoadAssociation.associateIncidentWithRoad = async ({ now }) => {
  calls.association += 1;
  if (inject.association) throw new Error('simulated road-association failure');
  return {
    road,
    distanceKm: 0.1,
    roadMatchConfidence: 'HIGH',
    associationMethod: 'MONGODB_2DSPHERE_DISTANCE_ONLY',
    associationTimestamp: now,
  };
};

// The BEFORE snapshot is the only call that passes { excludeIncidentId }; the AFTER recompute does not.
const realComputeAccessibility = accessibilityService.computeAccessibilityForRoad;
accessibilityService.computeAccessibilityForRoad = async (roadId, options) => {
  if (options && options.excludeIncidentId) {
    calls.accessibilityBefore += 1;
    if (inject.beforeSnapshot) throw new Error('simulated before-snapshot failure');
  } else {
    calls.accessibilityAfter += 1;
    if (inject.recompute) throw new Error('simulated recompute failure');
  }
  return realComputeAccessibility(roadId, options);
};

const realCalculateRisk = riskService.calculateRisk;
riskService.calculateRisk = (...args) => {
  calls.risk += 1;
  return realCalculateRisk(...args);
};

const { createIncident } = require('../src/controllers/incidentController');
const asyncHandler = require('../src/utils/asyncHandler');
const { errorHandler } = require('../src/utils/errorHandler');

// --- in-memory model I/O ---------------------------------------------------

let incidentStore; // id -> plain snapshot as last PERSISTED
let createdAlerts;
let seeded; // unrelated records + their fingerprints

const persist = (doc) => incidentStore.set(String(doc._id), doc.toObject());
const nullish = (a, b) => (a ?? null) === (b ?? null);

/** Evaluates exactly the filter shapes the controller sends: equality, null-matches-missing, $lt, $or, _id. */
function matches(snap, filter) {
  return Object.entries(filter).every(([key, want]) => {
    if (key === '$or') return want.some((f) => matches(snap, f));
    if (key === '_id') return String(snap._id) === String(want);
    if (want && typeof want === 'object' && '$lt' in want) return snap[key] != null && new Date(snap[key]) < want.$lt;
    return nullish(snap[key], want);
  });
}

Incident.findOne = async (query) => {
  calls.findOne += 1;
  if (inject.findOneMissesOnce && calls.findOne === 1) return null; // simulate the check-then-create race window
  const snap = [...incidentStore.values()].find((d) => d.clientEventId && d.clientEventId === query.clientEventId);
  return snap ? new Incident(snap) : null;
};
Incident.findById = async (id) => {
  const snap = incidentStore.get(String(id));
  return snap ? new Incident(snap) : null;
};
Incident.create = async (data) => {
  calls.create += 1;
  if (inject.createDuplicateKey) {
    const err = new Error('E11000 duplicate key error');
    err.code = 11000;
    throw err;
  }
  const doc = new Incident(data);
  const validation = doc.validateSync();
  if (validation) throw validation;
  persist(doc); // the raw report is durable from here on
  return doc;
};
/** Atomic claim: the whole find+update runs without yielding, like a single MongoDB operation. */
Incident.findOneAndUpdate = async (filter, update) => {
  calls.claim += 1;
  const snap = [...incidentStore.values()].find((d) => matches(d, filter));
  if (!snap) return null;
  Object.assign(snap, update.$set);
  return new Incident(snap);
};
/** Checkpoint / release writes. Honours the fencing-token filter; can be made to fail per $set. */
Incident.updateOne = async (filter, update) => {
  calls.persist += 1;
  if (inject.persistFail && inject.persistFail(update.$set)) throw new Error('simulated persistence failure');
  const snap = incidentStore.get(String(filter._id));
  if (!snap || !matches(snap, filter)) return { matchedCount: 0, modifiedCount: 0 };
  Object.assign(snap, update.$set);
  return { matchedCount: 1, modifiedCount: 1 };
};
Incident.find = (query) => ({
  sort: () => ({
    limit: async () =>
      [...incidentStore.values()].filter(
        (d) => d.roadId && String(d.roadId) === String(query.roadId) && !(query._id && String(d._id) === String(query._id.$ne))
      ),
  }),
});
Road.findById = async (id) => (String(id) === String(road._id) ? road : null);
DisasterAlert.find = async () => [];
// Faithful to alertService's dedup lookup: same incident + road + reason inside the window.
Alert.findOne = async (q) =>
  createdAlerts.find(
    (a) =>
      a.incidentId &&
      String(a.incidentId) === String(q.incidentId) &&
      String(a.roadId) === String(q.roadId) &&
      a.triggerReason === q.triggerReason &&
      a.generatedAt >= q.generatedAt.$gte
  ) || null;
Alert.create = async (data) => {
  const alert = { _id: new mongoose.Types.ObjectId(), ...data };
  createdAlerts.push(alert);
  return alert;
};

// --- helpers ---------------------------------------------------------------

const fp = (o) => JSON.stringify(o);

function reset() {
  incidentStore = new Map();
  createdAlerts = [];
  for (const k of Object.keys(calls)) delete calls[k];
  Object.assign(calls, { ai: 0, association: 0, accessibilityBefore: 0, accessibilityAfter: 0, risk: 0, create: 0, findOne: 0, claim: 0, persist: 0 });
  for (const k of Object.keys(inject)) delete inject[k];
  nextAi = {
    classification: 'LANDSLIDE',
    severity: 'HIGH',
    confidence: 0.97,
    summary: 'Severe landslide.',
    rationale: 'Keyword match.',
    model: 'heuristic-keyword-v1',
    source: 'DEMO_FALLBACK',
  };
  // Unrelated pre-existing records that no scenario may touch.
  const otherIncidents = [
    new Incident({ type: 'ROAD_DAMAGE', severity: 'MEDIUM', lat: 25.9, lng: 91.8, status: 'RESOLVED', clientEventId: 'UNRELATED-1', source: 'DRIVER_APP' }),
    new Incident({ type: 'FLOOD', severity: 'LOW', lat: 26.1, lng: 91.7, status: 'REPORTED', clientEventId: 'UNRELATED-2', source: 'DRIVER_APP' }),
  ];
  for (const d of otherIncidents) persist(d);
  const otherAlert = { _id: new mongoose.Types.ObjectId(), type: 'GENERAL', severity: 'LOW', message: 'pre-existing alert', source: 'FIELD_INCIDENT' };
  createdAlerts.push(otherAlert);
  seeded = {
    incidentIds: otherIncidents.map((d) => String(d._id)),
    incidentFp: otherIncidents.map((d) => fp(incidentStore.get(String(d._id)))),
    alertFp: fp(otherAlert),
  };
}

/** Request through the REAL asyncHandler + REAL errorHandler; resolves with { status, body }. */
function post(body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(b) { this.body = b; resolve({ status: this.statusCode ?? 200, body: b }); return this; },
    };
    asyncHandler(createIncident)({ body }, res, (err) => errorHandler(err, {}, res, () => {}));
  });
}

/** Waits (yielding to the event loop) until a condition holds. */
async function until(cond, ms = 2000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setImmediate(r));
  }
}

let seq = 0;
const payload = (overrides = {}) => ({
  type: 'LANDSLIDE',
  severity: 'LOW',
  lat: 24.839033206185018,
  lng: 92.83321918253361,
  description: 'Severe landslide, road collapsed and completely impassable.',
  source: 'DRIVER_APP',
  clientEventId: `I5-${Date.now()}-${(seq += 1)}`,
  ...overrides,
});

const snapOf = (clientEventId) => [...incidentStore.values()].find((d) => d.clientEventId === clientEventId);

/** What is durably stored for this clientEventId right now. */
function stored(clientEventId) {
  const snap = snapOf(clientEventId);
  if (!snap) return { persisted: false };
  return {
    persisted: true,
    id: String(snap._id),
    status: snap.status,
    severity: snap.severity,
    type: snap.type,
    processingState: snap.processingState ?? null,
    claimId: snap.processingClaimId ?? null,
    aiSource: snap.aiResult?.source ?? null,
    roadId: snap.roadId ? String(snap.roadId) : null,
    roadName: snap.roadName ?? null,
    roadMatchConfidence: snap.roadMatchConfidence ?? null,
    associationMethod: snap.associationMethod ?? null,
    raw: fp(snap),
  };
}

const newAlerts = () => createdAlerts.filter((a) => a.message !== 'pre-existing alert');

function assertUnrelatedUntouched() {
  assert.deepEqual(seeded.incidentIds.map((id) => fp(incidentStore.get(id))), seeded.incidentFp, 'unrelated incidents must be byte-identical');
  assert.equal(fp(createdAlerts.find((a) => a.message === 'pre-existing alert')), seeded.alertFp, 'unrelated alert must be byte-identical');
}

const ERR_500 = { success: false, error: 'Internal server error' };

/** Legacy row: written before processing state existed (processingState null). */
function seedLegacy(status, clientEventId) {
  const doc = new Incident({ type: 'LANDSLIDE', severity: 'LOW', lat: 24.839033206185018, lng: 92.83321918253361, description: 'legacy', status, clientEventId, source: 'DRIVER_APP' });
  persist(doc);
  return doc;
}

// =============================================================================
// Control and completed-incident replay (existing behaviour must be unchanged)
// =============================================================================

test('CONTROL (no failure): 201, AI_ANALYSED, COMPLETE; road + AI persisted; before/after accessibility once each; claim token never exposed', async () => {
  reset();
  const p = payload();
  const r = await post(p);
  assert.equal(r.status, 201);
  assert.equal(r.body.data.status, 'AI_ANALYSED');
  assert.equal(stored(p.clientEventId).processingState, 'COMPLETE', 'completion is recorded internally in storage');
  assert.equal('processingClaimId' in r.body.data, false, 'the fencing token is internal');
  assert.equal(r.body.data.resumed, undefined);
  assert.equal(r.body.data.idempotentReplay, undefined);
  assert.equal(r.body.data.roadDistanceKm, 0.1);
  assert.equal(r.body.data.accessibilityImpact.after.accessibilityScore, 90);

  const s = stored(p.clientEventId);
  assert.deepEqual([s.status, s.processingState, s.claimId, s.aiSource, s.roadName, s.roadMatchConfidence], ['AI_ANALYSED', 'COMPLETE', null, 'DEMO_FALLBACK', 'NH 27', 'HIGH']);
  assert.deepEqual({ ...calls }, { ai: 1, association: 1, accessibilityBefore: 1, accessibilityAfter: 1, risk: 1, create: 1, findOne: 1, claim: 0, persist: 3 });
  assert.equal(newAlerts().length, 0);
  assertUnrelatedUntouched();
});

test('COMPLETED replay is unchanged: 200 idempotentReplay, no step re-runs, no resumed flag, stored record byte-identical, payload edits ignored', async () => {
  reset();
  const p = payload();
  assert.equal((await post(p)).status, 201);
  const before = stored(p.clientEventId);
  const counters = { ...calls };

  for (const body of [p, { ...p, severity: 'HIGH', type: 'FLOOD', description: 'different' }]) {
    const r = await post(body);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.idempotentReplay, true);
    assert.equal(r.body.data.resumed, undefined, 'a finished incident is replayed, not resumed');
    assert.equal(r.body.data.status, 'AI_ANALYSED');
    assert.equal(r.body.data.severity, 'LOW');
    assert.equal(r.body.data.type, 'LANDSLIDE');
  }
  assert.equal(calls.ai, counters.ai);
  assert.equal(calls.association, counters.association);
  assert.equal(calls.accessibilityBefore, counters.accessibilityBefore);
  assert.equal(calls.accessibilityAfter, counters.accessibilityAfter);
  assert.equal(calls.create, counters.create);
  assert.equal(calls.claim, 0, 'no claim is attempted for a complete incident');
  assert.equal(calls.persist, counters.persist);
  assert.equal(stored(p.clientEventId).raw, before.raw);
  assertUnrelatedUntouched();
});

test('LEGACY rows (no processing state): finished statuses are replayed unchanged; a never-processed REPORTED row is resumed', async () => {
  reset();
  for (const status of ['AI_ANALYSED', 'VERIFIED', 'ACTION_REQUIRED', 'RESOLVED']) {
    const ceid = `LEGACY-${status}`;
    seedLegacy(status, ceid);
    const before = stored(ceid).raw;
    const r = await post(payload({ clientEventId: ceid }));
    assert.equal(r.status, 200, status);
    assert.equal(r.body.data.idempotentReplay, true);
    assert.equal(r.body.data.resumed, undefined, `${status}: existing production-shaped incidents must not be reprocessed`);
    assert.equal(stored(ceid).raw, before);
  }
  assert.deepEqual({ ai: calls.ai, association: calls.association, claim: calls.claim }, { ai: 0, association: 0, claim: 0 });

  seedLegacy('REPORTED', 'LEGACY-REPORTED');
  const r = await post(payload({ clientEventId: 'LEGACY-REPORTED' }));
  assert.equal(r.status, 200);
  assert.equal(r.body.data.resumed, true);
  const s = stored('LEGACY-REPORTED');
  assert.deepEqual([s.status, s.processingState, s.aiSource, s.roadName], ['AI_ANALYSED', 'COMPLETE', 'DEMO_FALLBACK', 'NH 27']);
  assertUnrelatedUntouched();
});

// =============================================================================
// I5-A: Incident.create succeeds, then the AI call throws.
// =============================================================================

test('I5-A: AI throws -> 500, report persisted as REPORTED/PENDING with the claim released; a retry resumes and completes it', async () => {
  reset();
  inject.ai = true;
  const p = payload();
  const r = await post(p);
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, ERR_500);

  const failed = stored(p.clientEventId);
  assert.deepEqual([failed.persisted, failed.status, failed.processingState, failed.claimId], [true, 'REPORTED', 'PENDING', null], 'resumable: PENDING and unowned');
  assert.deepEqual([failed.aiSource, failed.roadId, failed.severity], [null, null, 'LOW']);
  assert.deepEqual({ ai: calls.ai, association: calls.association, before: calls.accessibilityBefore, after: calls.accessibilityAfter }, { ai: 1, association: 0, before: 0, after: 0 });

  delete inject.ai; // the fault is gone
  // The retry even carries a "corrected" payload: the stored raw report stays authoritative.
  const retry = await post({ ...p, severity: 'HIGH', type: 'FLOOD', description: 'edited' });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.idempotentReplay, true);
  assert.equal(retry.body.data.resumed, true);
  assert.equal(retry.body.data.status, 'AI_ANALYSED');
  assert.equal(retry.body.data.severity, 'LOW');
  assert.equal(retry.body.data.type, 'LANDSLIDE');
  assert.equal(retry.body.data.accessibilityImpact.after.accessibilityScore, 90);

  const done = stored(p.clientEventId);
  assert.deepEqual([done.status, done.processingState, done.claimId, done.aiSource, done.roadName, done.severity, done.type], ['AI_ANALYSED', 'COMPLETE', null, 'DEMO_FALLBACK', 'NH 27', 'LOW', 'LANDSLIDE']);
  assert.deepEqual({ ai: calls.ai, association: calls.association, before: calls.accessibilityBefore, after: calls.accessibilityAfter }, { ai: 2, association: 1, before: 1, after: 1 });

  // And now it is a finished incident: a further replay changes nothing.
  const counters = { ...calls };
  const again = await post(p);
  assert.equal(again.status, 200);
  assert.equal(again.body.data.resumed, undefined);
  assert.equal(calls.ai, counters.ai);
  assert.equal(stored(p.clientEventId).raw, done.raw);
  assertUnrelatedUntouched();
});

// =============================================================================
// I5-B: create + AI succeed, then road association throws.
// =============================================================================

test('I5-B: association throws -> 500, but the AI result IS now checkpointed; the retry resumes WITHOUT re-running the AI', async () => {
  reset();
  inject.association = true;
  const p = payload();
  const r = await post(p);
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, ERR_500);

  const failed = stored(p.clientEventId);
  assert.deepEqual([failed.status, failed.processingState, failed.claimId], ['REPORTED', 'PENDING', null]);
  assert.equal(failed.aiSource, 'DEMO_FALLBACK', 'the computed AI result is no longer lost');
  assert.equal(failed.roadId, null);
  assert.deepEqual({ ai: calls.ai, association: calls.association, before: calls.accessibilityBefore }, { ai: 1, association: 1, before: 0 });

  delete inject.association;
  const retry = await post(p);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.resumed, true);

  const done = stored(p.clientEventId);
  assert.deepEqual([done.status, done.processingState, done.aiSource, done.roadName], ['AI_ANALYSED', 'COMPLETE', 'DEMO_FALLBACK', 'NH 27']);
  assert.equal(calls.ai, 1, 'the AI step was checkpointed, so it is not run again');
  assert.equal(calls.association, 2);
  assert.deepEqual({ before: calls.accessibilityBefore, after: calls.accessibilityAfter }, { before: 1, after: 1 });
  assertUnrelatedUntouched();
});

test('I5-B2: the before-accessibility snapshot throws -> 500, but AI result AND road match are checkpointed; the retry re-runs neither', async () => {
  reset();
  inject.beforeSnapshot = true;
  const p = payload();
  const r = await post(p);
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, ERR_500);

  const failed = stored(p.clientEventId);
  assert.deepEqual([failed.status, failed.processingState, failed.claimId], ['AI_ANALYSED', 'PENDING', null]);
  assert.deepEqual([failed.aiSource, failed.roadName, failed.roadMatchConfidence], ['DEMO_FALLBACK', 'NH 27', 'HIGH'], 'no longer lost');
  assert.deepEqual({ ai: calls.ai, association: calls.association, before: calls.accessibilityBefore, after: calls.accessibilityAfter }, { ai: 1, association: 1, before: 1, after: 0 });

  delete inject.beforeSnapshot;
  const retry = await post(p);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.resumed, true);
  assert.equal(stored(p.clientEventId).processingState, 'COMPLETE');
  assert.deepEqual({ ai: calls.ai, association: calls.association, before: calls.accessibilityBefore, after: calls.accessibilityAfter }, { ai: 1, association: 1, before: 2, after: 1 });
  assertUnrelatedUntouched();
});

// =============================================================================
// I5-C: a persistence/update step throws.
// =============================================================================

test('I5-C: the association checkpoint cannot be persisted -> 500, REPORTED/PENDING with the AI result kept; the retry redoes only the association', async () => {
  reset();
  inject.persistFail = (set) => 'associationTimestamp' in set;
  const p = payload();
  const r = await post(p);
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, ERR_500);

  const failed = stored(p.clientEventId);
  assert.deepEqual([failed.status, failed.processingState, failed.claimId], ['REPORTED', 'PENDING', null]);
  assert.equal(failed.aiSource, 'DEMO_FALLBACK');
  assert.deepEqual([failed.roadId, failed.associationMethod], [null, null], 'the unsaved association is not half-applied');
  assert.deepEqual({ ai: calls.ai, association: calls.association, before: calls.accessibilityBefore }, { ai: 1, association: 1, before: 0 });

  delete inject.persistFail;
  const retry = await post(p);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.resumed, true);
  const done = stored(p.clientEventId);
  assert.deepEqual([done.status, done.processingState, done.roadName], ['AI_ANALYSED', 'COMPLETE', 'NH 27']);
  assert.equal(calls.ai, 1);
  assert.equal(calls.association, 2);
  assertUnrelatedUntouched();
});

// =============================================================================
// I5-C2 + alert recovery: the recompute / alert step fails after the road changed.
// (HIGH severity so the transition really crosses the alert threshold.)
// =============================================================================

test('I5-C2: recompute throws after the road changed -> 500, incident complete-but-PENDING; the retry creates the missing alert EXACTLY ONCE', async () => {
  reset();
  inject.recompute = true;
  const p = payload({ severity: 'HIGH' });
  const r = await post(p);
  assert.equal(r.status, 500);
  assert.deepEqual(r.body, ERR_500);

  const failed = stored(p.clientEventId);
  assert.deepEqual([failed.status, failed.processingState, failed.claimId, failed.roadName], ['AI_ANALYSED', 'PENDING', null, 'NH 27']);
  assert.equal(newAlerts().length, 0, 'the alert did not get created in the failed attempt');
  // The road really did change (the incident is live evidence) — read through the REAL service.
  const acc = await realComputeAccessibility(road._id);
  assert.equal(acc.state, 'HIGH_RISK');
  assert.ok(acc.factors.some((f) => f.source === 'FIELD_INCIDENT' && f.contribution === -37.5));

  delete inject.recompute;
  const retry = await post(p);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.resumed, true);
  assert.ok(retry.body.data.alertGenerated, 'the retry reports the alert it created');
  assert.equal(stored(p.clientEventId).processingState, 'COMPLETE');

  assert.equal(newAlerts().length, 1, 'the lost alert is recovered');
  const alert = newAlerts()[0];
  assert.deepEqual([alert.type, alert.severity, alert.source], ['RISK_WARNING', 'MEDIUM', 'FIELD_INCIDENT']);
  assert.equal(String(alert.incidentId), failed.id);
  assert.equal(String(alert.roadId), String(road._id));
  assert.match(alert.triggerReason, /changed from \w+ to HIGH_RISK/);

  // Any further replay is a plain replay: still exactly one alert, nothing re-run.
  const counters = { ...calls };
  const again = await post(p);
  assert.equal(again.body.data.resumed, undefined);
  assert.equal(newAlerts().length, 1);
  assert.equal(calls.accessibilityAfter, counters.accessibilityAfter);
  assertUnrelatedUntouched();
});

test('ALERT RECOVERY: alert created, then the completion write fails -> the retry re-runs the recompute but dedup keeps exactly ONE alert', async () => {
  reset();
  inject.persistFail = (set) => set.processingState === 'COMPLETE';
  const p = payload({ severity: 'HIGH' });
  const r = await post(p);
  assert.equal(r.status, 500);
  assert.equal(newAlerts().length, 1, 'the alert was created before the failure');
  const failed = stored(p.clientEventId);
  assert.deepEqual([failed.status, failed.processingState, failed.claimId], ['AI_ANALYSED', 'PENDING', null]);

  delete inject.persistFail;
  const retry = await post(p);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.resumed, true);
  assert.equal(retry.body.data.alertGenerated, null, 'deduplicated: nothing new was generated');
  assert.equal(newAlerts().length, 1, 'no duplicate alert');
  assert.equal(stored(p.clientEventId).processingState, 'COMPLETE');
  assert.equal(calls.ai, 1);
  assert.equal(calls.association, 1);
  assert.deepEqual({ before: calls.accessibilityBefore, after: calls.accessibilityAfter }, { before: 2, after: 2 });
  assertUnrelatedUntouched();
});

test('REMAINING LIMITATION: if that retry happens after the 1-hour alert dedup window, a second identical alert is created', async () => {
  reset();
  inject.persistFail = (set) => set.processingState === 'COMPLETE';
  const p = payload({ severity: 'HIGH' });
  assert.equal((await post(p)).status, 500);
  assert.equal(newAlerts().length, 1);

  newAlerts()[0].generatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // alert is now older than DEDUP_WINDOW_MS
  delete inject.persistFail;
  assert.equal((await post(p)).status, 200);
  assert.equal(newAlerts().length, 2, 'documented limitation: crash between alert creation and completion + retry > 1 h later');
  assertUnrelatedUntouched();
});

// =============================================================================
// I5-D: replay paths
// =============================================================================

test('I5-D: the concurrent-duplicate path (create hits E11000) also RESUMES an incomplete incident instead of replaying it', async () => {
  reset();
  inject.ai = true;
  const p = payload();
  assert.equal((await post(p)).status, 500); // leaves a PENDING incident
  const counters = { ...calls };

  delete inject.ai;
  calls.findOne = 0;
  inject.findOneMissesOnce = true; // first lookup misses (race window) ...
  inject.createDuplicateKey = true; // ... then the unique index rejects the second insert

  const r = await post(p);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.idempotentReplay, true);
  assert.equal(r.body.data.resumed, true);
  assert.equal(calls.findOne, 2, 'lookup, then re-lookup after E11000');
  assert.equal(calls.ai, counters.ai + 1, 'the resume ran the AI step once');
  assert.deepEqual([stored(p.clientEventId).status, stored(p.clientEventId).processingState], ['AI_ANALYSED', 'COMPLETE']);
  assertUnrelatedUntouched();
});

// =============================================================================
// Concurrency: one owner at a time
// =============================================================================

test('CONCURRENCY: a replay that arrives while the first request is still processing gets 409 and runs nothing; the original then completes normally', async () => {
  reset();
  let open;
  inject.aiGateOnce = new Promise((resolve) => { open = resolve; });
  const p = payload();

  const original = post(p); // creates, claims, then blocks inside the AI step
  await until(() => calls.ai === 1);
  assert.equal(stored(p.clientEventId).processingState, 'IN_PROGRESS');

  const concurrent = await post(p);
  assert.equal(concurrent.status, 409);
  assert.equal(concurrent.body.success, false);
  assert.match(concurrent.body.error, /still being processed/);
  assert.equal(calls.ai, 1, 'the concurrent retry did not run the AI step');
  assert.equal(calls.association, 0);

  open();
  const done = await original;
  assert.equal(done.status, 201);
  assert.equal(stored(p.clientEventId).processingState, 'COMPLETE', 'completion is recorded internally in storage');
  assert.equal(calls.ai, 1);
  assert.equal(calls.association, 1);
  assert.deepEqual({ before: calls.accessibilityBefore, after: calls.accessibilityAfter }, { before: 1, after: 1 });

  const replay = await post(p); // afterwards: a normal completed replay
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.resumed, undefined);
  assert.equal(calls.ai, 1);
  assertUnrelatedUntouched();
});

test('CONCURRENCY: two simultaneous retries of a PENDING incident -> exactly one resumes it (200), the other gets 409; the pipeline runs once', async () => {
  reset();
  inject.ai = true;
  const p = payload({ severity: 'HIGH' });
  assert.equal((await post(p)).status, 500); // PENDING
  const aiBefore = calls.ai;

  delete inject.ai;
  let open;
  inject.aiGateOnce = new Promise((resolve) => { open = resolve; });
  const a = post(p);
  const b = post(p);
  await until(() => calls.ai === aiBefore + 1); // exactly one of them reached the AI step
  open();
  const results = await Promise.all([a, b]);

  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const winner = results.find((r) => r.status === 200);
  assert.equal(winner.body.data.resumed, true);
  assert.equal(calls.ai, aiBefore + 1, 'the AI step ran once for two concurrent retries');
  assert.equal(calls.association, 1);
  assert.equal(newAlerts().length, 1, 'one alert, not two');
  assert.equal(stored(p.clientEventId).processingState, 'COMPLETE');
  assertUnrelatedUntouched();
});

test('CONCURRENCY (fencing): a request whose lease expired and was taken over cannot overwrite the new owner — it gets 409 and changes nothing', async () => {
  reset();
  let open;
  inject.aiGateOnce = new Promise((resolve) => { open = resolve; });
  const p = payload({ severity: 'HIGH' });

  const slow = post(p); // owner A: stuck inside the AI step
  await until(() => calls.ai === 1);
  snapOf(p.clientEventId).processingClaimedAt = new Date(Date.now() - 3 * 60 * 1000); // A's lease has expired

  const takeover = await post(p); // B takes over (stale claim) and completes
  assert.equal(takeover.status, 200);
  assert.equal(takeover.body.data.resumed, true);
  assert.equal(calls.ai, 2);
  const afterB = stored(p.clientEventId);
  assert.equal(afterB.processingState, 'COMPLETE');
  assert.equal(newAlerts().length, 1);

  open(); // A's AI call finally returns and tries to checkpoint with its old token
  const lost = await slow;
  assert.equal(lost.status, 409, 'A detects it lost the claim');
  assert.equal(stored(p.clientEventId).raw, afterB.raw, 'A wrote nothing');
  assert.equal(calls.association, 1, 'A never reached the association step');
  assert.equal(newAlerts().length, 1);
  assertUnrelatedUntouched();
});

test('CONCURRENCY (lease): if even releasing the claim fails, a retry gets 409 while the lease is live and resumes once it has expired', async () => {
  reset();
  inject.ai = true;
  inject.persistFail = (set) => set.processingState === 'PENDING'; // the release write fails too
  const p = payload();
  assert.equal((await post(p)).status, 500);
  assert.equal(stored(p.clientEventId).processingState, 'IN_PROGRESS', 'claim could not be released');

  delete inject.ai;
  delete inject.persistFail;
  const tooSoon = await post(p);
  assert.equal(tooSoon.status, 409, 'the lease is still live');
  assert.equal(calls.ai, 1);

  snapOf(p.clientEventId).processingClaimedAt = new Date(Date.now() - 3 * 60 * 1000); // lease expires
  const resumed = await post(p);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.data.resumed, true);
  assert.deepEqual([stored(p.clientEventId).status, stored(p.clientEventId).processingState], ['AI_ANALYSED', 'COMPLETE']);
  assertUnrelatedUntouched();
});

// =============================================================================
// Summary: every failure point is recoverable
// =============================================================================

test('SUMMARY: for each of the five failure points the raw report survives and one retry completes the incident', async () => {
  const points = {
    ai: () => { inject.ai = true; },
    association: () => { inject.association = true; },
    beforeSnapshot: () => { inject.beforeSnapshot = true; },
    'association checkpoint': () => { inject.persistFail = (set) => 'associationTimestamp' in set; },
    recompute: () => { inject.recompute = true; },
  };
  for (const [name, arm] of Object.entries(points)) {
    reset();
    arm();
    const p = payload({ severity: 'HIGH' });
    const first = await post(p);
    assert.equal(first.status, 500, name);
    assert.equal(stored(p.clientEventId).persisted, true, `${name}: raw report survives`);
    assert.equal(stored(p.clientEventId).processingState, 'PENDING', `${name}: resumable`);

    for (const k of Object.keys(inject)) delete inject[k];
    const retry = await post(p);
    assert.equal(retry.status, 200, name);
    assert.equal(retry.body.data.resumed, true, name);
    const done = stored(p.clientEventId);
    assert.deepEqual([done.status, done.processingState, done.claimId, done.roadName, done.aiSource], ['AI_ANALYSED', 'COMPLETE', null, 'NH 27', 'DEMO_FALLBACK'], name);
    assert.equal(newAlerts().length, 1, `${name}: exactly one alert after recovery`);
    assertUnrelatedUntouched();
  }
});

// =============================================================================
// Serialization: the processing-recovery fields are internal (stored, never exposed)
// =============================================================================

const INTERNAL_FIELDS = ['processingState', 'processingClaimedAt', 'processingClaimId'];
const exposed = (obj) => INTERNAL_FIELDS.filter((k) => k in obj);

test('SERIALIZATION: none of the three internal fields appears in any incident JSON response, yet all stay in storage and processing still works', async () => {
  reset();
  // 201 (created), 200 resumed, 200 completed replay — every response path that serializes an incident.
  inject.ai = true;
  const p = payload();
  assert.equal((await post(p)).status, 500);
  assert.equal(stored(p.clientEventId).processingState, 'PENDING', 'stored internally');
  delete inject.ai;

  const resumed = await post(p);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.data.resumed, true, 'recovery behaviour is unchanged');
  assert.deepEqual(exposed(resumed.body.data), [], 'resumed response');

  const replay = await post(p);
  assert.equal(replay.status, 200);
  assert.deepEqual(exposed(replay.body.data), [], 'completed replay response');

  const created = await post(payload());
  assert.equal(created.status, 201);
  assert.deepEqual(exposed(created.body.data), [], 'creation response');
  assert.equal(stored(created.body.data.clientEventId).processingState, 'COMPLETE', 'still persisted internally');
  assert.equal(stored(p.clientEventId).processingState, 'COMPLETE');
  assertUnrelatedUntouched();
});

test('SERIALIZATION (model): toJSON drops all three fields for new, legacy-shaped and in-flight documents, including inside arrays; the document and toObject() keep them', () => {
  const inflight = new Incident({ type: 'FLOOD', lat: 25, lng: 92, processingState: 'IN_PROGRESS', processingClaimedAt: new Date(), processingClaimId: 'secret-fencing-token' });
  const legacy = new Incident({ type: 'FLOOD', lat: 25, lng: 92, status: 'AI_ANALYSED' }); // fields default to null
  for (const doc of [inflight, legacy]) {
    assert.deepEqual(exposed(doc.toJSON()), []);
    assert.deepEqual(exposed(JSON.parse(JSON.stringify([doc]))[0]), [], 'array serialization (GET /api/incidents)');
  }
  assert.equal(JSON.stringify(inflight).includes('secret-fencing-token'), false);
  assert.equal(inflight.processingState, 'IN_PROGRESS', 'still readable on the document (the controller relies on it)');
  assert.equal(inflight.processingClaimId, 'secret-fencing-token');
  assert.deepEqual(exposed(inflight.toObject()), INTERNAL_FIELDS, 'persistence shape is unchanged');
  assert.equal(inflight.toJSON().id !== undefined && inflight.toJSON()._id === undefined, true, 'existing id mapping is unchanged');
});
