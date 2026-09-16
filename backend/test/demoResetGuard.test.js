const test = require('node:test');
const assert = require('node:assert/strict');
const { isDemoResetAllowed } = require('../src/controllers/demoController');

test('demo reset is allowed only when APP_MODE is exactly "demo"', () => {
  assert.equal(isDemoResetAllowed('demo'), true);
});

test('demo reset is rejected when APP_MODE is "production"', () => {
  assert.equal(isDemoResetAllowed('production'), false);
});

test('demo reset is rejected when APP_MODE is unset (undefined)', () => {
  assert.equal(isDemoResetAllowed(undefined), false);
});

test('demo reset is rejected for any unexpected/misspelled value (e.g. staging typo)', () => {
  assert.equal(isDemoResetAllowed('Demo'), false); // case-sensitive, no fuzzy matching
  assert.equal(isDemoResetAllowed('staging'), false);
  assert.equal(isDemoResetAllowed(''), false);
});
