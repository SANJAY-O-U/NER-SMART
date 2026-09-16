/**
 * Road Graph Service
 * -------------------
 * Builds an in-memory graph from real, geometry-bearing Road documents.
 * Each road segment becomes ONE edge (per the mission's explicit
 * instruction — not sub-split into every intermediate vertex). Segment
 * endpoints become graph nodes, snapped together within a configurable
 * tolerance so genuinely-adjacent segments (which rarely share an exact
 * coordinate in real-world digitized data) connect into a traversable
 * graph.
 *
 * Graph construction (buildGraphFromRoads) is a PURE function — no I/O —
 * so it's fully unit-testable with synthetic road-like fixtures. Only
 * `getGraph()` touches the database.
 *
 * IMPORTANT, HONEST FINDING (documented in ROUTING_ARCHITECTURE.md):
 * at any defensible snapping tolerance (tested 50m-2.2km), the currently
 * imported 260-segment Guwahati-Imphal extract does NOT form a single
 * connected component end-to-end — Guwahati and Imphal fall in different
 * components. This is a REAL data-coverage gap, not a bug in this graph
 * builder. Routing honestly reports NO_CONNECTED_ROUTE for such pairs
 * rather than fabricating connectivity.
 */

// ~300m — a documented engineering default for snapping real-world
// digitized highway endpoints into shared graph nodes. Not derived from
// a survey of the source data's actual digitization tolerance.
const DEFAULT_SNAP_TOLERANCE_DEG = 0.003;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function lineStringLengthKm(coordinates) {
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    const [lng1, lat1] = coordinates[i - 1];
    const [lng2, lat2] = coordinates[i];
    total += haversineKm(lat1, lng1, lat2, lng2);
  }
  return total;
}

function geometryEndpoints(geometry) {
  if (geometry.type === 'LineString') {
    const c = geometry.coordinates;
    return { start: c[0], end: c[c.length - 1], fullCoordinates: c };
  }
  // MultiLineString: treat as one continuous path start->...->end for
  // graph purposes (documented simplification — internal breaks within
  // a single road's MultiLineString are not modeled as extra nodes).
  const first = geometry.coordinates[0];
  const last = geometry.coordinates[geometry.coordinates.length - 1];
  const flat = geometry.coordinates.flat();
  return { start: first[0], end: last[last.length - 1], fullCoordinates: flat };
}

/**
 * Pure graph builder. `roads` must be plain objects with at least:
 * { id/_id, name, geometry: {type, coordinates} }. Roads without
 * geometry are skipped (they have no shape to build an edge from).
 */
function buildGraphFromRoads(roads, { snapToleranceDeg = DEFAULT_SNAP_TOLERANCE_DEG } = {}) {
  const nodes = []; // array of [lng, lat]

  function snapNode(pt) {
    for (let i = 0; i < nodes.length; i += 1) {
      const dx = nodes[i][0] - pt[0];
      const dy = nodes[i][1] - pt[1];
      if (Math.sqrt(dx * dx + dy * dy) < snapToleranceDeg) return i;
    }
    nodes.push(pt);
    return nodes.length - 1;
  }

  const edges = []; // { roadId, roadName, fromNode, toNode, lengthKm, geometry, roadRef }
  const adjacency = new Map(); // nodeIndex -> [{ neighborNode, edgeIndex, direction: 'forward'|'reverse' }]

  function addAdjacency(nodeIdx, neighborNode, edgeIndex, direction) {
    if (!adjacency.has(nodeIdx)) adjacency.set(nodeIdx, []);
    adjacency.get(nodeIdx).push({ neighborNode, edgeIndex, direction });
  }

  for (const road of roads) {
    if (!road.geometry || !road.geometry.type || !road.geometry.coordinates) continue;
    if (road.geometry.type !== 'LineString' && road.geometry.type !== 'MultiLineString') continue;

    const { start, end, fullCoordinates } = geometryEndpoints(road.geometry);
    if (!start || !end) continue;

    const fromNode = snapNode(start);
    const toNode = snapNode(end);
    if (fromNode === toNode) continue; // degenerate/self-loop segment — not a usable edge

    const lengthKm = lineStringLengthKm(fullCoordinates);
    const edgeIndex = edges.length;

    edges.push({
      roadId: String(road.id || road._id),
      roadName: road.name,
      fromNode,
      toNode,
      lengthKm,
      geometry: fullCoordinates, // [lng,lat] order, as stored — forward direction (fromNode -> toNode)
      roadRef: road,
    });

    // Undirected: traversable both ways (a road can be driven in either direction).
    addAdjacency(fromNode, toNode, edgeIndex, 'forward');
    addAdjacency(toNode, fromNode, edgeIndex, 'reverse');
  }

  return { nodes, edges, adjacency, snapToleranceDeg };
}

/** Nearest graph node to a point, within maxDistanceKm. Never snaps silently far away. */
function snapToNearestNode(graph, lat, lng, maxDistanceKm = 20) {
  let best = -1;
  let bestDistKm = Infinity;
  for (let i = 0; i < graph.nodes.length; i += 1) {
    const [nLng, nLat] = graph.nodes[i];
    const d = haversineKm(lat, lng, nLat, nLng);
    if (d < bestDistKm) {
      bestDistKm = d;
      best = i;
    }
  }
  if (best === -1 || bestDistKm > maxDistanceKm) return null;
  return { nodeIndex: best, distanceKm: Math.round(bestDistKm * 100) / 100 };
}

/** BFS connected-component membership for one node — used to detect "no possible route" cases. */
function connectedComponent(graph, startNode) {
  const visited = new Set([startNode]);
  const queue = [startNode];
  while (queue.length) {
    const current = queue.shift();
    const neighbors = graph.adjacency.get(current) || [];
    for (const { neighborNode } of neighbors) {
      if (!visited.has(neighborNode)) {
        visited.add(neighborNode);
        queue.push(neighborNode);
      }
    }
  }
  return visited;
}

// --- Simple in-process cache (Phase 4C's documented "simple in-process
// graph cache is acceptable for this MVP" — no distributed cache). ---
let cachedGraph = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes — road geometry changes rarely (re-import is manual)

async function getGraph({ forceRebuild = false } = {}) {
  const Road = require('../models/Road'); // lazy require avoids a hard dependency for pure-function tests
  const now = Date.now();
  if (!forceRebuild && cachedGraph && now - cachedAt < CACHE_TTL_MS) {
    return cachedGraph;
  }
  const roads = await Road.find({ geometry: { $exists: true } }).lean();
  cachedGraph = buildGraphFromRoads(roads);
  cachedAt = now;
  return cachedGraph;
}

function invalidateGraphCache() {
  cachedGraph = null;
  cachedAt = 0;
}

module.exports = {
  buildGraphFromRoads,
  snapToNearestNode,
  connectedComponent,
  getGraph,
  invalidateGraphCache,
  haversineKm,
  lineStringLengthKm,
  DEFAULT_SNAP_TOLERANCE_DEG,
};
