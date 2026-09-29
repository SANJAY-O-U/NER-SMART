const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Phase 10.3.9: the AI severity firewall at the REAL incident-creation
// boundary (incidentController.createIncident), not just the evidence
// builder/engine in isolation. The controller, accessibilityService,
// accessibilityEvidence, accessibilityEngine, alertTriggerService and
// alertService all run for real. Only the edges are stubbed: the AI call,
// the geo road lookup, the weather lookup and MongoDB model I/O (an
// in-memory store that saves plain snapshots, like a real database would).

mongoose.set('bufferCommands', false); // any un-stubbed DB call fails fast instead of hanging

// Stubs must be installed BEFORE the controller/service modules destructure them.
const aiService = require('../src/services/aiService');
const incidentRoadAssociation = require('../src/services/incidentRoadAssociation');
const weatherRoadService = require('../src/services/weatherRoadService');

let nextAiResult = null;
aiService.analyzeIncident = async () => nextAiResult;
weatherRoadService.findWeatherForRoad = async () => null;

const Road = require('../src/models/Road');
const Incident = require('../src/models/Incident');
const DisasterAlert = require('../src/models/DisasterAlert');
const Alert = require('../src/models/Alert');

const road = new Road({ name: 'NH 27' });
incidentRoadAssociation.associateIncidentWithRoad = async ({ now }) => ({
  road,
  distanceKm: 0.1,
  roadMatchConfidence: 'HIGH',
  associationMethod: 'MONGODB_2DSPHERE_DISTANCE_ONLY',
  associationTimestamp: now,
});

const { createIncident } = require('../src/controllers/incidentController');

// --- in-memory model I/O ---------------------------------------------------

let incidentStore; // id -> plain snapshot as last saved
let createdAlerts;

function resetStores() {
  incidentStore = new Map();
  createdAlerts = [];
}

Incident.findOne = async () => null; // no idempotent replay in these tests
Incident.create = async (data) => {
  const doc = new Incident(data);
  doc.save = async function save() {
    const err = this.validateSync();
    if (err) throw err;
    incidentStore.set(String(this._id), this.toObject());
    return this;
  };
  return doc.save();
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
Alert.findOne = async () => null;
Alert.create = async (data) => {
  const alert = { _id: new mongoose.Types.ObjectId(), ...data };
  createdAlerts.push(alert);
  return alert;
};

// --- helpers ---------------------------------------------------------------

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function realAi(severity, overrides = {}) {
  return {
    classification: 'ROAD BLOCKED - IMPASSABLE',
    severity,
    confidence: 0.99,
    summary: 'Road completely blocked and impassable.',
    rationale: 'Description says the road collapsed.',
    model: 'gemini-3.6-flash',
    generatedAt: new Date(),
    source: 'REAL_AI',
    ...overrides,
  };
}

async function submit({ severity, ai }) {
  resetStores();
  nextAiResult = ai;
  const res = mockRes();
  await createIncident(
    {
      body: {
        type: 'LANDSLIDE',
        severity,
        lat: 24.839033206185018,
        lng: 92.83321918253361,
        description: 'Severe landslide, road collapsed and completely impassable.',
        source: 'DRIVER_APP',
        clientEventId: `FIREWALL_TEST_${Math.random().toString(36).slice(2)}`,
      },
    },
    res
  );
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const data = res.body.data;
  const saved = incidentStore.get(String(data.id));
  assert.ok(saved, 'the created incident was persisted');
  return { data, saved, alerts: createdAlerts };
}

const accSignature = (acc) => ({
  state: acc.state,
  accessibilityScore: acc.accessibilityScore,
  confidence: acc.confidence,
  factors: acc.factors.map((f) => ({ name: f.name, value: f.value, contribution: f.contribution })),
});

// --- tests -----------------------------------------------------------------

test('createIncident: REAL_AI HIGH recommendation never overwrites authoritative LOW severity', async () => {
  const { data, saved } = await submit({ severity: 'LOW', ai: realAi('HIGH') });

  assert.equal(saved.severity, 'LOW'); // persisted authoritative field
  assert.equal(data.severity, 'LOW'); // API response
  assert.equal(saved.status, 'AI_ANALYSED');

  // the AI recommendation is still recorded, as advisory data only
  assert.equal(saved.aiResult.source, 'REAL_AI');
  assert.equal(saved.aiResult.severity, 'HIGH');
  assert.equal(saved.aiResult.model, 'gemini-3.6-flash');
  assert.equal(saved.aiResult.confidence, 0.99);
});

test('createIncident: accessibility evidence uses authoritative LOW; AI HIGH cannot force BLOCKED/RESTRICTED', async () => {
  const { data } = await submit({ severity: 'LOW', ai: realAi('HIGH') });
  const after = data.accessibilityImpact.after;

  const landslide = after.factors.find((f) => f.name === 'LANDSLIDE');
  assert.ok(landslide, 'the incident became evidence');
  assert.equal(landslide.value, 0.2); // LOW risk 20 -> 0.2, not HIGH 75
  assert.equal(landslide.contribution, -10); // 20 * 0.5, not 75 * 0.5
  assert.match(after.explanation, /LOW severity LANDSLIDE/);
  assert.doesNotMatch(after.explanation, /HIGH severity/);

  assert.equal(after.state, 'OPEN');
  assert.equal(after.accessibilityScore, 90);
  assert.notEqual(after.state, 'BLOCKED');
  assert.notEqual(after.state, 'RESTRICTED');
  assert.notEqual(after.state, 'HIGH_RISK');
});

test('createIncident: accessibility and alert outcome are identical whatever the AI recommends (LOW incident)', async () => {
  const withAiHigh = await submit({ severity: 'LOW', ai: realAi('HIGH') });
  const withAiLow = await submit({ severity: 'LOW', ai: realAi('LOW', { classification: 'LANDSLIDE', confidence: 0.1 }) });
  const withFallback = await submit({ severity: 'LOW', ai: aiService.analyzeWithFallback({ type: 'LANDSLIDE', description: 'minor' }) });

  for (const other of [withAiLow, withFallback]) {
    assert.deepEqual(accSignature(withAiHigh.data.accessibilityImpact.after), accSignature(other.data.accessibilityImpact.after));
    assert.deepEqual(accSignature(withAiHigh.data.accessibilityImpact.before), accSignature(other.data.accessibilityImpact.before));
    assert.equal(withAiHigh.alerts.length, other.alerts.length);
  }
  assert.equal(withAiHigh.alerts.length, 0);
  assert.equal(withAiHigh.data.alertGenerated, null);
});

test('createIncident: alerts follow authoritative accessibility — an AI LOW cannot suppress an authoritative HIGH, and alert severity ignores aiResult', async () => {
  const withAiLow = await submit({ severity: 'HIGH', ai: realAi('LOW', { classification: 'NO HAZARD', confidence: 0.99 }) });
  const withAiHigh = await submit({ severity: 'HIGH', ai: realAi('HIGH') });

  assert.equal(withAiLow.saved.severity, 'HIGH');
  assert.equal(withAiLow.saved.aiResult.severity, 'LOW');

  const after = withAiLow.data.accessibilityImpact.after;
  assert.equal(after.factors.find((f) => f.name === 'LANDSLIDE').value, 0.75); // authoritative HIGH
  assert.equal(after.state, 'HIGH_RISK'); // from the incident's own severity
  assert.notEqual(after.state, 'BLOCKED'); // incidents alone never reach BLOCKED/RESTRICTED
  assert.notEqual(after.state, 'RESTRICTED');

  // the alert is driven by the accessibility transition, not by aiResult
  assert.equal(withAiLow.alerts.length, 1);
  const alert = withAiLow.alerts[0];
  assert.equal(alert.type, 'RISK_WARNING');
  assert.equal(alert.severity, 'MEDIUM'); // DEGRADED, not BLOCKED -> MEDIUM
  assert.equal(alert.source, 'FIELD_INCIDENT');

  // same authoritative severity, opposite AI recommendation -> same alert
  assert.deepEqual(accSignature(withAiHigh.data.accessibilityImpact.after), accSignature(after));
  assert.equal(withAiHigh.alerts.length, 1);
  const { _id: _a, incidentId: _i1, ...alertLow } = withAiLow.alerts[0];
  const { _id: _b, incidentId: _i2, ...alertHigh } = withAiHigh.alerts[0];
  assert.deepEqual(alertHigh, { ...alertLow, generatedAt: alertHigh.generatedAt, timestamp: alertHigh.timestamp });
});
