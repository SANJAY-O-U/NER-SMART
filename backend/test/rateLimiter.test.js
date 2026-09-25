const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRateLimitOptions, buildGeneralLimiter, buildWriteLimiter } = require('../src/middleware/rateLimiter');

// The actual request-counting/429 behavior is express-rate-limit's own
// well-tested internals — exercised live in this phase's manual
// verification (see PHASE1_SECURITY_HARDENING.md), not re-tested here.
// What IS ours to test is the pure env-parsing/defaults logic.

test('buildRateLimitOptions applies documented defaults when env is empty', () => {
  const options = buildRateLimitOptions({});
  assert.equal(options.windowMs, 15 * 60 * 1000);
  assert.equal(options.generalMax, 300);
  assert.equal(options.writeMax, 30);
});

test('buildRateLimitOptions reads configured values from env', () => {
  const options = buildRateLimitOptions({
    NER_RATE_LIMIT_WINDOW_MINUTES: '5',
    NER_RATE_LIMIT_MAX: '100',
    NER_WRITE_RATE_LIMIT_MAX: '10',
  });
  assert.equal(options.windowMs, 5 * 60 * 1000);
  assert.equal(options.generalMax, 100);
  assert.equal(options.writeMax, 10);
});

test('buildRateLimitOptions falls back to defaults for invalid (non-positive/non-numeric) env values', () => {
  const options = buildRateLimitOptions({
    NER_RATE_LIMIT_WINDOW_MINUTES: 'not-a-number',
    NER_RATE_LIMIT_MAX: '-5',
    NER_WRITE_RATE_LIMIT_MAX: '0',
  });
  assert.equal(options.windowMs, 15 * 60 * 1000);
  assert.equal(options.generalMax, 300);
  assert.equal(options.writeMax, 30);
});

test('buildGeneralLimiter and buildWriteLimiter return usable Express middleware functions', () => {
  const general = buildGeneralLimiter({});
  const write = buildWriteLimiter({});
  assert.equal(typeof general, 'function');
  assert.equal(typeof write, 'function');
});
