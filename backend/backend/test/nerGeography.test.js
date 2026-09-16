const test = require('node:test');
const assert = require('node:assert/strict');
const {
  lookupDistrictByLgdCode,
  findDistrictNamesInText,
  isNerState,
  NER_STATES,
  NER_DISTRICT_HQ_APPROX,
} = require('../src/config/nerGeography');

test('lookupDistrictByLgdCode resolves a known code to the correct district and state', () => {
  const d = lookupDistrictByLgdCode(244);
  assert.deepEqual(d, { name: 'DIMAPUR', state: 'NAGALAND' });
});

test('lookupDistrictByLgdCode returns null for an unknown/newer-than-2020 code', () => {
  // 764 = Chumoukedima, a district created in 2021 — confirmed absent
  // from the 2020-dated source during Phase 3B, see file header comment.
  assert.equal(lookupDistrictByLgdCode(764), null);
});

test('lookupDistrictByLgdCode coerces string input', () => {
  assert.deepEqual(lookupDistrictByLgdCode('245'), { name: 'KOHIMA', state: 'NAGALAND' });
});

test('findDistrictNamesInText finds multiple known districts in a real areaDesc string', () => {
  const found = findDistrictNamesInText('Chumoukedima, Dimapur, Kohima, Meluri, Niuland, Peren, Phek districts of Nagaland');
  const names = found.map((d) => d.name);
  assert.ok(names.includes('DIMAPUR'));
  assert.ok(names.includes('KOHIMA'));
  assert.ok(names.includes('PEREN'));
  assert.ok(names.includes('PHEK'));
  // Chumoukedima, Meluri, Niuland are NOT matched — not in our LGD table.
  assert.ok(!names.includes('CHUMOUKEDIMA'));
});

test('findDistrictNamesInText matches Tripura districts by name even with no LGD code', () => {
  const found = findDistrictNamesInText('Heavy rain expected over Gomati and Khowai districts');
  const gomati = found.find((d) => d.name === 'GOMATI');
  assert.ok(gomati);
  assert.equal(gomati.lgdCode, null);
  assert.equal(gomati.state, 'TRIPURA');
});

test('findDistrictNamesInText returns empty array for text with no NER district names', () => {
  const found = findDistrictNamesInText('Light rain over Diu, Devbhumi Dwarka, Junagadh, Porbandar');
  assert.deepEqual(found, []);
});

test('findDistrictNamesInText handles empty/null input without throwing', () => {
  assert.deepEqual(findDistrictNamesInText(''), []);
  assert.deepEqual(findDistrictNamesInText(null), []);
});

test('isNerState correctly identifies all 8 NER states', () => {
  for (const state of NER_STATES) {
    assert.equal(isNerState(state), true);
    assert.equal(isNerState(state.toLowerCase()), true); // case-insensitive
  }
});

test('isNerState returns false for a non-NER state', () => {
  assert.equal(isNerState('GUJARAT'), false);
  assert.equal(isNerState('DELHI'), false);
});

test('isNerState handles null/undefined without throwing', () => {
  assert.equal(isNerState(null), false);
  assert.equal(isNerState(undefined), false);
});

test('NER_DISTRICT_HQ_APPROX only covers districts on the Guwahati-Imphal corridor', () => {
  const names = NER_DISTRICT_HQ_APPROX.map((d) => d.district);
  assert.ok(names.includes('DIMAPUR'));
  assert.ok(names.includes('KOHIMA'));
  assert.ok(names.includes('IMPHAL WEST'));
  // Every entry must have real, usable coordinates.
  NER_DISTRICT_HQ_APPROX.forEach((d) => {
    assert.equal(typeof d.lat, 'number');
    assert.equal(typeof d.lng, 'number');
  });
});
