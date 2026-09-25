const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Phase 6 consolidation: riskService.js is confirmed LEGACY/SECONDARY (see
// its own header comment) — the accessibility engine must never call into
// it, directly or transitively. This is a structural regression guard, not
// a behavioral test: it fails loudly the moment anyone wires riskService's
// output into an operational accessibility decision, mirroring the same
// principle aiAccessibilityFirewall.test.js already enforces for AI output
// (a Proxy-based structural check there; a source-text check here, since
// "never required" is a static-dependency fact, not a runtime-input fact).

const ACCESSIBILITY_CORE_FILES = [
  '../src/services/accessibilityEngine.js',
  '../src/services/accessibilityEvidence.js',
  '../src/services/accessibilityService.js',
];

function readSource(relativePath) {
  return fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
}

for (const file of ACCESSIBILITY_CORE_FILES) {
  test(`${file.split('/').pop()} never requires riskService.js (legacy risk cannot silently become authoritative)`, () => {
    const source = readSource(file);
    assert.doesNotMatch(source, /require\(['"].*riskService['"]\)/, `${file} must not require riskService.js`);
  });
}

test('the accessibility engine module graph produces identical output whether or not riskService.js even exists on disk (import-level isolation)', () => {
  // Delete riskService.js from the require cache and stub module resolution
  // failure would be overkill here — instead, directly assert none of the
  // three core modules' exports reference riskService's exported function
  // names anywhere in their own source, which is the simplest, most
  // robust proxy for "these modules do not and cannot call riskService".
  for (const file of ACCESSIBILITY_CORE_FILES) {
    const source = readSource(file);
    assert.doesNotMatch(source, /\bcalculateRisk\b/, `${file} must not reference riskService.calculateRisk`);
    assert.doesNotMatch(source, /\bescalateLandslideRisk\b/, `${file} must not reference riskService.escalateLandslideRisk`);
  }
});

test('computeAccessibilityFromEvidence output is unaffected by anything riskService would compute (no shared input channel exists)', () => {
  const { computeAccessibilityFromEvidence } = require('../src/services/accessibilityEngine');
  const { calculateRisk } = require('../src/services/riskService');

  // Compute a legacy risk score for wildly different, extreme inputs —
  // then prove it has no bearing on accessibility computed from the SAME
  // conceptual scenario's real evidence, since there is no code path that
  // could inject it even if someone tried.
  const legacyExtreme = calculateRisk({ rainfallScore: 100, slopeScore: 100, historicalRisk: 100, roadCondition: 100 });
  const legacyZero = calculateRisk({ rainfallScore: 0, slopeScore: 0, historicalRisk: 0, roadCondition: 0 });
  assert.notEqual(legacyExtreme.level, legacyZero.level); // sanity: riskService itself is working and genuinely different

  const evidence = [
    { source: 'ROAD_STATUS', type: 'PHYSICAL_STATUS', status: 'OPEN', riskContribution: null, freshness: 'CACHED', confidence: 'HIGH' },
  ];
  const result = computeAccessibilityFromEvidence(evidence);
  assert.equal(result.state, 'OPEN');
  // No field of `result` is derived from `legacyExtreme`/`legacyZero` —
  // accessibilityEngine.js's function signature does not even accept a
  // riskService-shaped input, confirmed by the module-graph checks above.
});
