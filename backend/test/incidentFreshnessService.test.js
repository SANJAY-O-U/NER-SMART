const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIncidentFreshness, incidentAgeHours, STALE_AFTER_HOURS } = require('../src/services/incidentFreshnessService');

const NOW = new Date('2026-09-16T12:00:00Z');

test('a just-reported incident is LIVE', () => {
  const incident = { timestamp: new Date('2026-09-16T11:00:00Z') };
  assert.equal(classifyIncidentFreshness(incident, { now: NOW }), 'LIVE');
});

test('an incident right at the staleness boundary is still LIVE', () => {
  const incident = { timestamp: new Date(NOW.getTime() - STALE_AFTER_HOURS * 60 * 60 * 1000) };
  assert.equal(classifyIncidentFreshness(incident, { now: NOW }), 'LIVE');
});

test('an incident just past the staleness boundary is STALE', () => {
  const incident = { timestamp: new Date(NOW.getTime() - (STALE_AFTER_HOURS + 1) * 60 * 60 * 1000) };
  assert.equal(classifyIncidentFreshness(incident, { now: NOW }), 'STALE');
});

test('an incident with no timestamp at all is treated as maximally stale, never fabricated as fresh', () => {
  const incident = {};
  assert.equal(classifyIncidentFreshness(incident, { now: NOW }), 'STALE');
  assert.equal(incidentAgeHours(incident, NOW), Infinity);
});

test('falls back to createdAt when timestamp is absent', () => {
  const incident = { createdAt: new Date('2026-09-16T10:00:00Z') };
  assert.equal(classifyIncidentFreshness(incident, { now: NOW }), 'LIVE');
});

test('staleAfterHours is configurable for testing without waiting real time', () => {
  const incident = { timestamp: new Date(NOW.getTime() - 2 * 60 * 60 * 1000) }; // 2h old
  assert.equal(classifyIncidentFreshness(incident, { now: NOW, staleAfterHours: 1 }), 'STALE');
  assert.equal(classifyIncidentFreshness(incident, { now: NOW, staleAfterHours: 3 }), 'LIVE');
});
