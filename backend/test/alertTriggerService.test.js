const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldTriggerAlert } = require('../src/services/alertTriggerService');

test('no prior state means no alert (nothing has "changed" yet)', () => {
  const result = shouldTriggerAlert(null, { state: 'HIGH_RISK', accessibilityScore: 41 });
  assert.equal(result.trigger, false);
});

test('no new state at all means no alert', () => {
  const result = shouldTriggerAlert({ state: 'OPEN', accessibilityScore: 90 }, null);
  assert.equal(result.trigger, false);
});

test('state degradation (OPEN -> HIGH_RISK) triggers, mission worked example', () => {
  const result = shouldTriggerAlert({ state: 'OPEN', accessibilityScore: 72 }, { state: 'HIGH_RISK', accessibilityScore: 41 });
  assert.equal(result.trigger, true);
  assert.equal(result.direction, 'DEGRADED');
  assert.match(result.reason, /OPEN to HIGH_RISK/);
});

test('state degradation to BLOCKED triggers', () => {
  const result = shouldTriggerAlert({ state: 'RESTRICTED', accessibilityScore: 50 }, { state: 'BLOCKED', accessibilityScore: 5 });
  assert.equal(result.trigger, true);
  assert.equal(result.direction, 'DEGRADED');
});

test('state improvement (recovery) triggers with RECOVERED direction', () => {
  const result = shouldTriggerAlert({ state: 'HIGH_RISK', accessibilityScore: 30 }, { state: 'OPEN', accessibilityScore: 95 });
  assert.equal(result.trigger, true);
  assert.equal(result.direction, 'RECOVERED');
});

test('a small score change within the same state does NOT trigger (avoids spam)', () => {
  const result = shouldTriggerAlert({ state: 'OPEN', accessibilityScore: 90 }, { state: 'OPEN', accessibilityScore: 85 });
  assert.equal(result.trigger, false);
});

test('a large score drop within the SAME state still triggers', () => {
  const result = shouldTriggerAlert({ state: 'HIGH_RISK', accessibilityScore: 55 }, { state: 'HIGH_RISK', accessibilityScore: 22 });
  assert.equal(result.trigger, true);
  assert.equal(result.direction, 'DEGRADED');
});

test('identical before/after never triggers', () => {
  const result = shouldTriggerAlert({ state: 'OPEN', accessibilityScore: 100 }, { state: 'OPEN', accessibilityScore: 100 });
  assert.equal(result.trigger, false);
});

test('is deterministic', () => {
  const before = { state: 'OPEN', accessibilityScore: 80 };
  const after = { state: 'HIGH_RISK', accessibilityScore: 40 };
  const a = shouldTriggerAlert(before, after);
  const b = shouldTriggerAlert(before, after);
  assert.deepEqual(a, b);
});
