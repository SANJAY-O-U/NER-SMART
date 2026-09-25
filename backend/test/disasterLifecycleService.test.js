const test = require('node:test');
const assert = require('node:assert/strict');
const { isAlertExpired, DEFAULT_MAX_AGE_HOURS_WHEN_NO_EXPIRY } = require('../src/services/disasterLifecycleService');

const NOW = new Date('2026-09-23T12:00:00Z');

test('an alert with an explicit CAP expires in the past is expired, regardless of age since sent', () => {
  const alert = { expires: new Date('2026-09-23T11:00:00Z'), sent: NOW }; // expired 1h ago, but "sent" is right now
  assert.equal(isAlertExpired(alert, { now: NOW }), true);
});

test('an alert with an explicit CAP expires in the future is not expired, even if sent long ago', () => {
  const alert = { expires: new Date('2026-09-24T00:00:00Z'), sent: new Date('2026-01-01T00:00:00Z') };
  assert.equal(isAlertExpired(alert, { now: NOW }), false);
});

test('an alert with no expires falls back to age since sent: fresh -> not expired', () => {
  const alert = { expires: null, sent: new Date('2026-09-23T10:00:00Z') }; // 2h old
  assert.equal(isAlertExpired(alert, { now: NOW }), false);
});

test('an alert with no expires falls back to age since sent: past the default fallback window -> expired', () => {
  const alert = { expires: null, sent: new Date('2026-09-20T00:00:00Z') }; // ~84h old, past 72h default
  assert.equal(isAlertExpired(alert, { now: NOW }), true);
});

test('an alert with no expires and no sent falls back to age since firstSeenAt', () => {
  const fresh = { expires: null, sent: null, firstSeenAt: new Date('2026-09-23T11:00:00Z') }; // 1h old
  const old = { expires: null, sent: null, firstSeenAt: new Date('2026-09-01T00:00:00Z') }; // weeks old
  assert.equal(isAlertExpired(fresh, { now: NOW }), false);
  assert.equal(isAlertExpired(old, { now: NOW }), true);
});

test('an alert with no expires, no sent, and no firstSeenAt is treated as unverifiable -> expired', () => {
  assert.equal(isAlertExpired({ expires: null, sent: null, firstSeenAt: null }, { now: NOW }), true);
});

test('the fallback window is configurable for testing and documented as 72 hours by default', () => {
  assert.equal(DEFAULT_MAX_AGE_HOURS_WHEN_NO_EXPIRY, 72);
  const alert = { expires: null, sent: new Date('2026-09-23T00:00:00Z') }; // 12h old
  assert.equal(isAlertExpired(alert, { now: NOW, maxAgeHoursWhenNoExpiry: 6 }), true);
  assert.equal(isAlertExpired(alert, { now: NOW, maxAgeHoursWhenNoExpiry: 24 }), false);
});
