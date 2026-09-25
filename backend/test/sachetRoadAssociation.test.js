const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { associateAlertWithRoads } = require('../src/services/sachetRoadAssociation');
const Road = require('../src/models/Road');

// sachetRoadAssociation.js queries Road.find() directly (no injection
// point exists today, matching this project's DB-touching-code
// convention). We verify its behavior by stubbing Road.find itself for
// the duration of each test — no live MongoDB connection required — and
// always restore the original afterward.
function withStubbedRoadFind(roads, fn) {
  const original = Road.find;
  Road.find = () => ({ select: async () => roads });
  return fn().finally(() => {
    Road.find = original;
  });
}

test('an alert with no matched districts produces no road association at all (never guesses)', async () => {
  const result = await associateAlertWithRoads({ matchedDistricts: [] });
  assert.deepEqual(result.affectedRoadIds, []);
  assert.equal(result.associationMethod, null);
  assert.equal(result.associationConfidence, null);
  assert.equal(result.matchedRoadCount, 0);
});

test('an alert whose matched district has no roads in our dataset produces no association (never fabricated)', async () => {
  await withStubbedRoadFind([], async () => {
    const result = await associateAlertWithRoads({ matchedDistricts: [{ name: 'NoRoadsDistrict', state: 'Assam' }] });
    assert.deepEqual(result.affectedRoadIds, []);
    assert.equal(result.associationMethod, null);
    assert.equal(result.matchedRoadCount, 0);
  });
});

test('association method/confidence is downgraded to approximate/MEDIUM when any matched road only has an approximate district assignment', async () => {
  const id1 = new mongoose.Types.ObjectId();
  const id2 = new mongoose.Types.ObjectId();
  await withStubbedRoadFind(
    [
      { _id: id1, district: 'Kamrup', districtAssignmentMethod: 'NEAREST_DISTRICT_HQ_APPROXIMATION' },
      { _id: id2, district: 'Kamrup', districtAssignmentMethod: 'NEAREST_DISTRICT_HQ_APPROXIMATION' },
    ],
    async () => {
      const result = await associateAlertWithRoads({ matchedDistricts: [{ name: 'Kamrup', state: 'Assam' }] });
      assert.equal(result.associationMethod, 'NEAREST_DISTRICT_HQ_APPROXIMATION');
      assert.equal(result.associationConfidence, 'MEDIUM');
      assert.equal(result.matchedRoadCount, 2);
      assert.deepEqual(result.affectedRoadIds, [id1, id2]);
    }
  );
});

test('association is district-level only — it never returns polygon or exact-geometry information, even when roads match', async () => {
  const id1 = new mongoose.Types.ObjectId();
  await withStubbedRoadFind([{ _id: id1, district: 'Kamrup', districtAssignmentMethod: 'NEAREST_DISTRICT_HQ_APPROXIMATION' }], async () => {
    const result = await associateAlertWithRoads({ matchedDistricts: [{ name: 'Kamrup', state: 'Assam' }] });
    assert.ok(!('polygon' in result));
    assert.ok(!('exactMatch' in result));
    assert.ok(['LGD_DISTRICT_MATCH', 'NEAREST_DISTRICT_HQ_APPROXIMATION'].includes(result.associationMethod));
  });
});
