const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDisasterEvidence, buildWeatherEvidence, buildRoadStatusEvidence } = require('../src/services/accessibilityEvidence');
const { computeAccessibilityFromEvidence } = require('../src/services/accessibilityEngine');
const { computeDisasterRiskContribution } = require('../src/services/disasterRiskAdapter');
const { extractRiskFeaturesFromWeather } = require('../src/services/weatherRiskAdapter');
const { classifyFreshness } = require('../src/services/freshnessService');

const NOW = new Date('2026-09-23T12:00:00Z');

function activeAlert(overrides = {}) {
  return {
    identifier: 'IN-TEST-1',
    event: 'Flood',
    severity: 'Severe',
    urgency: 'Expected',
    certainty: 'Likely',
    lifecycleStatus: 'ACTIVE',
    associationConfidence: 'MEDIUM',
    associationMethod: 'LGD_DISTRICT_MATCH',
    sent: NOW,
    ...overrides,
  };
}

// --- E. SACHET + stale WeatherAPI weather ---

test('an active SACHET alert combined with STALE weather: state is driven by SACHET alone, stale weather is excluded from the cascade', () => {
  const disasterEvidence = buildDisasterEvidence([activeAlert()], computeDisasterRiskContribution, NOW);
  const staleWeatherEvidence = buildWeatherEvidence(
    {
      observation: {
        source: 'WEATHERAPI_CURRENT',
        observedAt: new Date('2026-09-20T00:00:00Z'), // 3+ days old -> STALE
        receivedAt: new Date('2026-09-20T00:00:05Z'),
      },
      distanceKm: 5,
      confidence: 'HIGH',
    },
    () => ({ explanation: [{ factor: 'rainfall', contribution: 95 }] }), // would be HIGH_RISK if trusted
    { now: NOW, classifyFreshness }
  );

  const combined = computeAccessibilityFromEvidence([...disasterEvidence, ...staleWeatherEvidence], { now: NOW });

  assert.equal(combined.state, 'HIGH_RISK'); // from SACHET's own severe/expected/likely score
  const staleFactor = combined.evidence.find((e) => e.source === 'WEATHERAPI_CURRENT');
  assert.ok(staleFactor, 'stale weather evidence should still be visible/inspectable, just not trusted as current');
});

// --- F. SACHET + authoritative ROAD_STATUS ---

test('explicit BLOCKED road status still outranks an active, severe SACHET alert (priority cascade unchanged)', () => {
  const disasterEvidence = buildDisasterEvidence([activeAlert({ severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' })], computeDisasterRiskContribution, NOW);
  const blockedRoadEvidence = buildRoadStatusEvidence({ physicalStatus: 'BLOCKED', lastVerifiedAt: NOW });

  const { state } = computeAccessibilityFromEvidence([...blockedRoadEvidence, ...disasterEvidence], { now: NOW });
  assert.equal(state, 'BLOCKED');
});

test('an OPEN field status does not suppress a live SACHET alert\'s risk contribution — both stay visible', () => {
  const disasterEvidence = buildDisasterEvidence([activeAlert()], computeDisasterRiskContribution, NOW);
  const openRoadEvidence = buildRoadStatusEvidence({ fieldStatus: 'OPEN', lastVerifiedAt: NOW });

  const { state, evidence } = computeAccessibilityFromEvidence([...openRoadEvidence, ...disasterEvidence], { now: NOW });
  assert.equal(state, 'HIGH_RISK'); // SACHET evidence still drives risk even though the road is nominally OPEN
  assert.ok(evidence.some((e) => e.source === 'NDMA_SACHET'));
  assert.ok(evidence.some((e) => e.source === 'ROAD_STATUS'));
});

// --- H. Multiple simultaneous SACHET alerts ---

test('two simultaneous active SACHET alerts on the same road both appear as independent evidence items, neither overwrites the other', () => {
  const alerts = [
    activeAlert({ identifier: 'IN-TEST-FLOOD', event: 'Flood', severity: 'Severe' }),
    activeAlert({ identifier: 'IN-TEST-LANDSLIDE', event: 'Landslide', severity: 'Extreme', urgency: 'Immediate', certainty: 'Observed' }),
  ];
  const evidence = buildDisasterEvidence(alerts, computeDisasterRiskContribution, NOW);
  assert.equal(evidence.length, 2);
  assert.deepEqual(evidence.map((e) => e.type).sort(), ['FLOOD', 'LANDSLIDE']);

  const { state, evidence: finalEvidence } = computeAccessibilityFromEvidence(evidence, { now: NOW });
  assert.equal(state, 'HIGH_RISK');
  assert.equal(finalEvidence.length, 2); // both retained, not collapsed into one
});
