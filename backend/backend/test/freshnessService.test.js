const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFreshness, FRESHNESS_WINDOWS_MINUTES } = require('../src/services/freshnessService');

const NOW = new Date('2026-09-15T12:00:00Z');

test('classifies a very recent observation as LIVE', () => {
  const observedAt = new Date(NOW.getTime() - 10 * 60000); // 10 min ago
  assert.equal(classifyFreshness({ observedAt, receivedAt: observedAt, now: NOW }), 'LIVE');
});

test('classifies an observation just inside the LIVE window as LIVE', () => {
  const observedAt = new Date(NOW.getTime() - FRESHNESS_WINDOWS_MINUTES.LIVE * 60000);
  assert.equal(classifyFreshness({ observedAt, receivedAt: observedAt, now: NOW }), 'LIVE');
});

test('classifies an observation just outside the LIVE window as CACHED', () => {
  const observedAt = new Date(NOW.getTime() - (FRESHNESS_WINDOWS_MINUTES.LIVE + 1) * 60000);
  assert.equal(classifyFreshness({ observedAt, receivedAt: observedAt, now: NOW }), 'CACHED');
});

test('classifies an observation beyond the CACHED window as STALE', () => {
  const observedAt = new Date(NOW.getTime() - (FRESHNESS_WINDOWS_MINUTES.CACHED + 60) * 60000);
  assert.equal(classifyFreshness({ observedAt, receivedAt: observedAt, now: NOW }), 'STALE');
});

test('classifies as UNAVAILABLE when there is no timestamp at all', () => {
  assert.equal(classifyFreshness({ observedAt: null, receivedAt: null, now: NOW }), 'UNAVAILABLE');
});

test('falls back to receivedAt when observedAt is missing', () => {
  const receivedAt = new Date(NOW.getTime() - 5 * 60000);
  assert.equal(classifyFreshness({ observedAt: null, receivedAt, now: NOW }), 'LIVE');
});

test('always returns UNAVAILABLE when hasCredentials is false, regardless of data age', () => {
  const observedAt = new Date(NOW.getTime() - 1 * 60000); // 1 min ago — would be LIVE otherwise
  assert.equal(classifyFreshness({ observedAt, receivedAt: observedAt, now: NOW, hasCredentials: false }), 'UNAVAILABLE');
});

test('treats a future timestamp (clock skew) as UNAVAILABLE rather than LIVE', () => {
  const observedAt = new Date(NOW.getTime() + 10 * 60000); // 10 min in the future
  assert.equal(classifyFreshness({ observedAt, receivedAt: observedAt, now: NOW }), 'UNAVAILABLE');
});
