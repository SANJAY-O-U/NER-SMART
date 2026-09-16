const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGraphFromRoads, snapToNearestNode, connectedComponent, lineStringLengthKm } = require('../src/services/roadGraphService');

function road(id, name, coords) {
  return { id, name, geometry: { type: 'LineString', coordinates: coords } };
}

test('buildGraphFromRoads creates one edge per road with distinct endpoints', () => {
  const roads = [road('r1', 'Road A', [[91.0, 26.0], [91.1, 26.1]])];
  const graph = buildGraphFromRoads(roads);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.nodes.length, 2);
});

test('buildGraphFromRoads snaps nearby endpoints into a shared node', () => {
  const roads = [
    road('r1', 'Road A', [[91.0, 26.0], [91.1, 26.1]]),
    road('r2', 'Road B', [[91.1001, 26.1001], [91.2, 26.2]]), // ~15m from Road A's end
  ];
  const graph = buildGraphFromRoads(roads, { snapToleranceDeg: 0.003 });
  assert.equal(graph.nodes.length, 3); // shared junction + 2 distinct ends
  assert.equal(graph.edges.length, 2);
});

test('buildGraphFromRoads skips roads with no geometry', () => {
  const roads = [{ id: 'r1', name: 'No geometry road' }];
  const graph = buildGraphFromRoads(roads);
  assert.equal(graph.edges.length, 0);
});

test('buildGraphFromRoads skips degenerate segments (identical start/end)', () => {
  const roads = [road('r1', 'Loop', [[91.0, 26.0], [91.0, 26.0]])];
  const graph = buildGraphFromRoads(roads);
  assert.equal(graph.edges.length, 0);
});

test('buildGraphFromRoads adds undirected adjacency both ways', () => {
  const roads = [road('r1', 'Road A', [[91.0, 26.0], [91.1, 26.1]])];
  const graph = buildGraphFromRoads(roads);
  assert.equal(graph.adjacency.get(0).length, 1);
  assert.equal(graph.adjacency.get(1).length, 1);
});

test('lineStringLengthKm computes a plausible distance', () => {
  // Guwahati to Imphal straight-line distance is ~265km — a much shorter
  // synthetic segment should be a small positive number.
  const km = lineStringLengthKm([[91.7362, 26.1445], [91.8, 26.2]]);
  assert.ok(km > 0 && km < 20);
});

test('snapToNearestNode finds the closest node within the max distance', () => {
  const roads = [road('r1', 'Road A', [[91.0, 26.0], [91.1, 26.1]])];
  const graph = buildGraphFromRoads(roads);
  const snap = snapToNearestNode(graph, 26.001, 91.001, 20);
  assert.equal(snap.nodeIndex, 0);
  assert.ok(snap.distanceKm < 1);
});

test('snapToNearestNode returns null when nothing is within range (never silently snaps far away)', () => {
  const roads = [road('r1', 'Road A', [[91.0, 26.0], [91.1, 26.1]])];
  const graph = buildGraphFromRoads(roads);
  // Mumbai — thousands of km from this tiny synthetic graph.
  const snap = snapToNearestNode(graph, 19.076, 72.8777, 20);
  assert.equal(snap, null);
});

test('connectedComponent finds only nodes reachable from the start', () => {
  const roads = [
    road('r1', 'Island A road', [[91.0, 26.0], [91.1, 26.1]]),
    road('r2', 'Island B road', [[95.0, 30.0], [95.1, 30.1]]), // far away, disconnected
  ];
  const graph = buildGraphFromRoads(roads, { snapToleranceDeg: 0.003 });
  const comp = connectedComponent(graph, 0);
  assert.equal(comp.size, 2); // just Island A's two nodes
  assert.ok(!comp.has(2) && !comp.has(3));
});

test('connectedComponent spans a chain of connected roads transitively', () => {
  const roads = [
    road('r1', 'A-B', [[91.0, 26.0], [91.1, 26.1]]),
    road('r2', 'B-C', [[91.1001, 26.1001], [91.2, 26.2]]),
    road('r3', 'C-D', [[91.2001, 26.2001], [91.3, 26.3]]),
  ];
  const graph = buildGraphFromRoads(roads, { snapToleranceDeg: 0.003 });
  const startNode = 0;
  const comp = connectedComponent(graph, startNode);
  assert.equal(comp.size, 4); // A,B,C,D all connected transitively
});
