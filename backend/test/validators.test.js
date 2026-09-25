const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  isValidObjectId,
  isValidLat,
  isValidLng,
  enumValuesFor,
  isValidEnumValue,
  sanitizeStringParam,
  validateObjectIdParam,
} = require('../src/utils/validators');

// A tiny throwaway model, defined once, purely to exercise enumValuesFor/
// isValidEnumValue against a real Mongoose schema without touching any
// real model or the database.
const TestModel =
  mongoose.models.__ValidatorsTestModel ||
  mongoose.model(
    '__ValidatorsTestModel',
    new mongoose.Schema({ level: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'] }, note: { type: String } })
  );

test('isValidObjectId accepts a real ObjectId string and rejects garbage', () => {
  assert.equal(isValidObjectId(new mongoose.Types.ObjectId().toString()), true);
  assert.equal(isValidObjectId('not-an-id'), false);
  assert.equal(isValidObjectId(''), false);
  assert.equal(isValidObjectId(undefined), false);
  assert.equal(isValidObjectId({ $ne: null }), false); // never accepts an operator object
});

test('isValidLat/isValidLng enforce numeric range and type', () => {
  assert.equal(isValidLat(25.5), true);
  assert.equal(isValidLat(91), false);
  assert.equal(isValidLat(-91), false);
  assert.equal(isValidLat(NaN), false);
  assert.equal(isValidLat('25.5'), false); // must be a real number, not a numeric string
  assert.equal(isValidLng(92.8), true);
  assert.equal(isValidLng(181), false);
  assert.equal(isValidLng(-181), false);
});

test('enumValuesFor reads the live schema enum, not a duplicated list', () => {
  assert.deepEqual(enumValuesFor(TestModel, 'level'), ['LOW', 'MEDIUM', 'HIGH']);
  assert.deepEqual(enumValuesFor(TestModel, 'note'), []); // no enum declared
});

test('isValidEnumValue accepts a declared value and rejects an undeclared one', () => {
  assert.equal(isValidEnumValue(TestModel, 'level', 'HIGH'), true);
  assert.equal(isValidEnumValue(TestModel, 'level', 'CRITICAL'), false);
});

test('isValidEnumValue is permissive for a field with no declared enum (nothing to restrict against)', () => {
  assert.equal(isValidEnumValue(TestModel, 'note', 'anything goes'), true);
});

test('sanitizeStringParam passes through a real string and rejects everything else', () => {
  assert.equal(sanitizeStringParam('roadId123'), 'roadId123');
  assert.equal(sanitizeStringParam(undefined), undefined);
  assert.equal(sanitizeStringParam(123), undefined);
  // The exact shape Express's default query parser produces for
  // `?roadId[$ne]=x` — must never pass through as a usable filter value.
  assert.equal(sanitizeStringParam({ $ne: 'x' }), undefined);
});

test('validateObjectIdParam middleware rejects an invalid param with 400 and never calls next', () => {
  const middleware = validateObjectIdParam('id');
  const req = { params: { id: 'not-an-id' } };
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(res.statusCode, 400);
  assert.equal(nextCalled, false);
});

test('validateObjectIdParam middleware calls next() for a valid id', () => {
  const middleware = validateObjectIdParam('id');
  const req = { params: { id: new mongoose.Types.ObjectId().toString() } };
  const res = { status() { return this; }, json() { return this; } };
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});
