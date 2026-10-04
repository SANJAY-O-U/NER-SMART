const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Phase 11.1 I-2: `clientEventId` is a client-generated STRING. A non-string value must be rejected
// (422) BEFORE any MongoDB lookup or processing, because Mongoose casts operator-shaped values
// ({ $ne: null }, { $regex }, arrays -> $in) into query operators that could select an arbitrary
// incident, which the I5 resume logic would then claim and process.
//
// Every model write/read the controller can reach, plus the AI and road-association steps, is replaced by a
// counter, so "rejected inputs perform NO lookup and NO processing" is asserted directly. Requests go
// through the REAL asyncHandler and errorHandler (NODE_ENV=production) like production.

mongoose.set('bufferCommands', false); // any un-stubbed DB call fails fast instead of hanging
process.env.NODE_ENV = 'production';
console.error = () => {}; // errorHandler logs the stack of the deliberate sentinel failure below

const aiService = require('../src/services/aiService');
const incidentRoadAssociation = require('../src/services/incidentRoadAssociation');

const calls = {};
const reset = () => {
  for (const k of Object.keys(calls)) delete calls[k];
  Object.assign(calls, { findOne: [], findById: 0, create: [], findOneAndUpdate: 0, updateOne: 0, ai: 0, association: 0 });
};
reset();

aiService.analyzeIncident = async () => { calls.ai += 1; throw new Error('AI must not run'); };
incidentRoadAssociation.associateIncidentWithRoad = async () => { calls.association += 1; throw new Error('association must not run'); };

const Incident = require('../src/models/Incident');
let existing = null; // what the stubbed lookup returns
Incident.findOne = async (query) => { calls.findOne.push(query); return existing; };
Incident.findById = async () => { calls.findById += 1; return existing; };
Incident.create = async (data) => { calls.create.push(data); throw new Error('sentinel: stop after create'); };
Incident.findOneAndUpdate = async () => { calls.findOneAndUpdate += 1; return null; };
Incident.updateOne = async () => { calls.updateOne += 1; return { matchedCount: 0, modifiedCount: 0 }; };

const { createIncident } = require('../src/controllers/incidentController');
const asyncHandler = require('../src/utils/asyncHandler');
const { errorHandler } = require('../src/utils/errorHandler');

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

const base = () => ({ type: 'LANDSLIDE', severity: 'LOW', lat: 24.84, lng: 92.83, description: 'x', source: 'DRIVER_APP' });
const nothingTouched = () => {
  assert.deepEqual(calls.findOne, [], 'no incident lookup');
  assert.equal(calls.findById, 0);
  assert.deepEqual(calls.create, [], 'no create');
  assert.equal(calls.findOneAndUpdate, 0, 'no claim');
  assert.equal(calls.updateOne, 0, 'no checkpoint');
  assert.equal(calls.ai, 0, 'no AI');
  assert.equal(calls.association, 0, 'no road association');
};

const REJECTED = {
  'operator { $ne: null }': { $ne: null },
  'operator { $regex: ".*" }': { $regex: '.*' },
  'operator { $gt: "" }': { $gt: '' },
  'operator { $in: [...] }': { $in: ['a', 'b'] },
  'array ["a","b"]': ['a', 'b'],
  'empty array []': [],
  'number 123': 123,
  'number 0': 0,
  'boolean true': true,
  'boolean false': false,
  'null': null,
  'empty object {}': {},
  'nested object': { id: 'abc' },
};

for (const [label, value] of Object.entries(REJECTED)) {
  test(`rejected before any lookup or processing: clientEventId = ${label}`, async () => {
    reset();
    existing = { shouldNeverBeReturned: true };
    const r = await post({ ...base(), clientEventId: value });
    assert.equal(r.status, 422);
    assert.deepEqual(r.body, { success: false, error: 'clientEventId must be a string' });
    nothingTouched();
  });
}

test('a rejected operator value cannot select, replay or resume an existing incident (the lookup that would have matched is never made)', async () => {
  reset();
  existing = { processingState: 'PENDING', status: 'REPORTED', toJSON: () => ({ id: 'victim' }) }; // an incomplete incident belonging to someone else
  for (const v of [{ $ne: null }, { $regex: '^' }]) {
    const r = await post({ ...base(), clientEventId: v });
    assert.equal(r.status, 422);
    assert.equal(r.body.data, undefined, 'no incident data is returned');
  }
  nothingTouched();
});

test('valid string clientEventId: reaches the lookup unchanged and an existing completed incident is replayed exactly as before', async () => {
  reset();
  existing = { processingState: 'COMPLETE', status: 'AI_ANALYSED', toJSON: () => ({ id: 'abc123', status: 'AI_ANALYSED', clientEventId: 'ABC-123' }) };
  const r = await post({ ...base(), clientEventId: 'ABC-123' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, data: { id: 'abc123', status: 'AI_ANALYSED', clientEventId: 'ABC-123', idempotentReplay: true } });
  assert.deepEqual(calls.findOne, [{ clientEventId: 'ABC-123' }], 'the exact string is looked up, nothing else');
  assert.deepEqual(calls.create, []);
  assert.equal(calls.findOneAndUpdate, 0, 'a completed incident is not claimed');
  assert.equal(calls.ai + calls.association, 0);
});

test('valid string clientEventId with no existing incident: proceeds to create with that string (existing behaviour)', async () => {
  reset();
  existing = null;
  const r = await post({ ...base(), clientEventId: 'NEW-EVENT-1' });
  assert.equal(r.status, 500); // only because the stubbed create throws a sentinel after being reached
  assert.deepEqual(r.body, { success: false, error: 'Internal server error' }); // sanitized production error
  assert.deepEqual(calls.findOne, [{ clientEventId: 'NEW-EVENT-1' }]);
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].clientEventId, 'NEW-EVENT-1');
});

test('missing clientEventId: preserved - optional, no lookup, create proceeds with clientEventId null', async () => {
  reset();
  const r = await post(base());
  assert.equal(r.status, 500); // sentinel from the stubbed create
  assert.deepEqual(calls.findOne, [], 'no lookup without a key');
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].clientEventId, null);
});

test('empty-string clientEventId: preserved - treated as no key (no lookup, stored as null), exactly as before', async () => {
  reset();
  const r = await post({ ...base(), clientEventId: '' });
  assert.equal(r.status, 500); // sentinel from the stubbed create
  assert.deepEqual(calls.findOne, []);
  assert.equal(calls.create[0].clientEventId, null);
});

test('the other required-field validations are unchanged and still win first (missing type/lat/lng -> 422 with the existing message)', async () => {
  reset();
  const r = await post({ lat: 24.8, lng: 92.8, clientEventId: { $ne: null } });
  assert.equal(r.status, 422);
  assert.deepEqual(r.body, { success: false, error: 'type, lat, and lng are required' });
  nothingTouched();
});
