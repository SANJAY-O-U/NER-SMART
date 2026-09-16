const test = require('node:test');
const assert = require('node:assert/strict');
const { dijkstra } = require('../src/services/routeGraphAlgorithm');
const { buildGraphFromRoads } = require('../src/services/roadGraphService');

function road(id, name, coords) {
  return { id, name, geometry: { type: 'LineString', coordinates: coords } };
}

// Simple diamond graph: 0 -- 1 -- 3 (via road A/B, short), 0 -- 2 -- 3 (via road C/D, longer)
function buildDiamondGraph() {
  const roads = [
    road('A', 'Road A', [[91.0, 26.0], [91.05, 26.0]]), // 0->1
    road('B', 'Road B', [[91.0501, 26.0], [91.1, 26.0]]), // 1->3
    road('C', 'Road C', [[91.0, 26.0001], [91.03, 26.05]]), // 0->2 (different path)
    road('D', 'Road D', [[91.0301, 26.0501], [91.1, 26.0]]), // 2->3
  ];
  return buildGraphFromRoads(roads, { snapToleranceDeg: 0.003 });
}

test('dijkstra finds a basic path between two connected nodes', () => {
  const graph = buildDiamondGraph();
  const flatCost = (edge) => ({ cost: edge.lengthKm, blocked: false });
  const result = dijkstra(graph, 0, 2, flatCost); // node 2 = [91.1, 26.0], the diamond's far corner
  assert.ok(result);
  assert.ok(result.path.length >= 2);
});

test('dijkstra returns null for disconnected nodes', () => {
  const roads = [
    road('r1', 'Island A', [[91.0, 26.0], [91.1, 26.1]]),
    road('r2', 'Island B', [[95.0, 30.0], [95.1, 30.1]]),
  ];
  const graph = buildGraphFromRoads(roads, { snapToleranceDeg: 0.003 });
  const cost = (edge) => ({ cost: edge.lengthKm, blocked: false });
  const result = dijkstra(graph, 0, 2, cost);
  assert.equal(result, null);
});

test('dijkstra excludes edges the cost function marks as blocked', () => {
  const graph = buildDiamondGraph();
  // Block road A (the direct 0->1 edge) — path must route around via C/D.
  const cost = (edge) => (edge.roadId === 'A' ? { cost: Infinity, blocked: true } : { cost: edge.lengthKm, blocked: false });
  const result = dijkstra(graph, 0, 2, cost);
  assert.ok(result);
  const usedRoadA = result.edgeSequence.some((s) => graph.edges[s.edgeIndex].roadId === 'A');
  assert.equal(usedRoadA, false);
});

test('dijkstra returns null when ALL paths are blocked', () => {
  const graph = buildDiamondGraph();
  const cost = () => ({ cost: Infinity, blocked: true });
  const result = dijkstra(graph, 0, 2, cost);
  assert.equal(result, null);
});

test('dijkstra prefers the lower-cost path when costs diverge', () => {
  const graph = buildDiamondGraph();
  // Make road A/B artificially expensive so the C/D path wins despite being geometrically longer.
  const cost = (edge) => {
    if (edge.roadId === 'A' || edge.roadId === 'B') return { cost: 1000, blocked: false };
    return { cost: edge.lengthKm, blocked: false };
  };
  const result = dijkstra(graph, 0, 2, cost);
  const usedA = result.edgeSequence.some((s) => graph.edges[s.edgeIndex].roadId === 'A');
  assert.equal(usedA, false);
});

test('dijkstra handles start === end trivially', () => {
  const graph = buildDiamondGraph();
  const cost = (edge) => ({ cost: edge.lengthKm, blocked: false });
  const result = dijkstra(graph, 0, 0, cost);
  assert.deepEqual(result.path, [0]);
  assert.equal(result.totalCost, 0);
});
