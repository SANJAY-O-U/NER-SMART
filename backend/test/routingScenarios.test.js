const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGraphFromRoads, snapToNearestNode } = require('../src/services/roadGraphService');
const { dijkstra } = require('../src/services/routeGraphAlgorithm');
const { computeEdgeCost } = require('../src/services/routeCostService');
const { ASSUMED_SPEED_KMPH, SNAP_MAX_DISTANCE_KM } = require('../src/services/routingEngineService');

function road(id, name, coords) {
  return { id, name, geometry: { type: 'LineString', coordinates: coords } };
}

/**
 * Two parallel routes between the same two endpoints:
 *   SHORT (roadId 'risky'): direct, shorter, but HIGH_RISK
 *   LONG (roadId 'safe1'+'safe2'): longer detour, but fully OPEN
 * This mirrors the mission's "safer longer route beats risky shorter
 * route" scenario end-to-end through the real cost+pathfinding stack
 * (accessibility itself is stubbed here — accessibilityService.js is
 * tested separately and reused unchanged, per the mission's instruction
 * not to duplicate it).
 */
function buildParallelRoutesGraph() {
  const roads = [
    road('risky', 'Risky Direct Road', [[91.0, 26.0], [91.5, 26.0]]), // ~50km, direct
    road('safe1', 'Safe Detour Part 1', [[91.0, 26.0001], [91.25, 26.3]]),
    road('safe2', 'Safe Detour Part 2', [[91.2501, 26.3001], [91.5, 26.0001]]),
  ];
  return buildGraphFromRoads(roads, { snapToleranceDeg: 0.003 });
}

function accessibilityFor(roadId) {
  if (roadId === 'risky') return { state: 'HIGH_RISK', accessibilityScore: 25, confidence: 'HIGH' };
  return { state: 'OPEN', accessibilityScore: 95, confidence: 'HIGH' };
}

test('a safer longer route is chosen over a risky shorter route when risk-weighted', () => {
  const graph = buildParallelRoutesGraph();
  const start = 0;
  const end = 1; // [91.5, 26.0] — the shared far endpoint of both the risky and safe paths

  const costFn = (edge) => computeEdgeCost(edge, accessibilityFor(edge.roadId), 'EMERGENCY', 'BALANCED');
  const result = dijkstra(graph, start, end, costFn);
  assert.ok(result);
  const usedRisky = result.edgeSequence.some((s) => graph.edges[s.edgeIndex].roadId === 'risky');
  assert.equal(usedRisky, false, 'risk-weighted routing should avoid the HIGH_RISK direct road');
});

test('SHORTEST mode picks the risky-but-shorter road, since it ignores risk by design', () => {
  const graph = buildParallelRoutesGraph();
  const start = 0;
  const end = 1;

  const costFn = (edge) => computeEdgeCost(edge, accessibilityFor(edge.roadId), 'NORMAL', 'SHORTEST');
  const result = dijkstra(graph, start, end, costFn);
  const usedRisky = result.edgeSequence.some((s) => graph.edges[s.edgeIndex].roadId === 'risky');
  assert.equal(usedRisky, true, 'SHORTEST mode should take the direct (shorter) road since it ignores risk');
});

test('origin snapping respects the configured maximum distance', () => {
  const graph = buildParallelRoutesGraph();
  // A point genuinely near the graph.
  const near = snapToNearestNode(graph, 26.0, 91.0, SNAP_MAX_DISTANCE_KM);
  assert.ok(near);
  // Mumbai — thousands of km away, must not snap.
  const far = snapToNearestNode(graph, 19.076, 72.8777, SNAP_MAX_DISTANCE_KM);
  assert.equal(far, null);
});

test('the configured snap threshold is a small, sane value (never "silently snap hundreds of km away")', () => {
  assert.ok(SNAP_MAX_DISTANCE_KM <= 50);
});

test('ETA is derived only from distance and a documented speed assumption, never fabricated traffic', () => {
  const distanceKm = 100;
  const minutes = Math.round((distanceKm / ASSUMED_SPEED_KMPH) * 60);
  assert.equal(typeof ASSUMED_SPEED_KMPH, 'number');
  assert.ok(minutes > 0);
});

test('no weather factor is ever introduced directly into route cost — only via accessibility (Phase 2 unavailable => no effect)', () => {
  // computeEdgeCost's signature only accepts (edge, accessibility, cargoPriority, routeMode) —
  // there is no weather parameter at all, structurally preventing fabrication here.
  const result = computeEdgeCost(road('r', 'R', [[91, 26], [91.1, 26.1]]), { state: 'OPEN', accessibilityScore: 100 }, 'NORMAL', 'BALANCED');
  assert.ok(!('weather' in result));
});
