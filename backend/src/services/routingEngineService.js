/**
 * Routing Engine Service
 * ------------------------
 * Orchestrates the real graph-based routing pipeline:
 *
 *   real road graph (roadGraphService)
 *     -> snap origin/destination to graph nodes
 *     -> per-edge accessibility (accessibilityService — REUSED, not duplicated)
 *     -> per-edge cost (routeCostService)
 *     -> Dijkstra (routeGraphAlgorithm)
 *     -> route contract (distance/ETA/risk/accessibility/confidence/reasons/geometry)
 *
 * Computes THREE alternatives per request: SAFEST_FEASIBLE (maximum risk
 * aversion, regardless of requested cargo priority — the genuinely
 * safest possible path), BALANCED (cost weighted by the ACTUAL requested
 * cargo priority — this is "the" recommendation), and SHORTEST_FEASIBLE
 * (distance only, BLOCKED still excluded).
 */

const { getGraph, snapToNearestNode, connectedComponent } = require('./roadGraphService');
const { dijkstra } = require('./routeGraphAlgorithm');
const { computeEdgeCost } = require('./routeCostService');
const { computeAccessibilityForRoad } = require('./accessibilityService');

// Documented assumption — NOT real traffic/speed data. See ROUTING_ARCHITECTURE.md.
const ASSUMED_SPEED_KMPH = 35; // conservative default for NER hill/highway corridor roads

const SNAP_MAX_DISTANCE_KM = 20; // never silently snap further than this

/**
 * Precomputes accessibility for every edge in the graph ONCE per
 * request (not cached long-term — Phase 4B evidence, e.g. SACHET
 * expiry, must be reflected the moment it changes). For the current
 * corridor-sized graph (a few hundred edges) this is an acceptable
 * per-request cost; see ROUTING_ARCHITECTURE.md for the scaling note.
 */
async function computeEdgeAccessibilityMap(graph) {
  const map = new Map(); // roadId -> accessibility result
  await Promise.all(
    graph.edges.map(async (edge) => {
      try {
        const result = await computeAccessibilityForRoad(edge.roadId);
        map.set(edge.roadId, result);
      } catch (err) {
        map.set(edge.roadId, null); // treat as UNKNOWN rather than fail the whole route
      }
    })
  );
  return map;
}

function buildCostFn(graph, accessibilityMap, cargoPriority, routeMode) {
  return (edge) => {
    const accessibility = accessibilityMap.get(edge.roadId) || null;
    return computeEdgeCost(edge, accessibility, cargoPriority, routeMode);
  };
}

/** Reconstructs real route geometry by concatenating edge geometries in traversal order/direction. */
function buildRouteGeometry(graph, edgeSequence) {
  const coordinates = [];
  for (const { edgeIndex, direction } of edgeSequence) {
    const edge = graph.edges[edgeIndex];
    const coords = direction === 'forward' ? edge.geometry : [...edge.geometry].reverse();
    if (coordinates.length > 0) coordinates.pop(); // avoid duplicating the shared junction point
    coordinates.push(...coords);
  }
  return { type: 'LineString', coordinates };
}

function summarizePath(graph, dijkstraResult, accessibilityMap) {
  const { edgeSequence } = dijkstraResult;
  const edges = edgeSequence.map((s) => graph.edges[s.edgeIndex]);

  const distanceKm = Math.round(edges.reduce((sum, e) => sum + e.lengthKm, 0) * 10) / 10;
  const estimatedTravelMinutes = Math.round((distanceKm / ASSUMED_SPEED_KMPH) * 60);

  const scored = edges
    .map((e) => accessibilityMap.get(e.roadId))
    .filter((a) => a && a.accessibilityScore !== null && a.accessibilityScore !== undefined);

  const accessibilityScore = scored.length
    ? Math.round(scored.reduce((sum, a) => sum + a.accessibilityScore, 0) / scored.length)
    : null;
  const riskScore = accessibilityScore !== null ? Math.round((1 - accessibilityScore / 100) * 100) / 100 : null;
  const accessibilityCoverage = edges.length ? Math.round((scored.length / edges.length) * 100) / 100 : 0;

  // Confidence: rank-averaged edge confidence, discounted for poor
  // accessibility coverage. Documented, deterministic — not a black box.
  const confRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const withConf = edges.map((e) => accessibilityMap.get(e.roadId)).filter((a) => a && a.confidence);
  let confidence = null;
  if (withConf.length) {
    const avgRank = withConf.reduce((sum, a) => sum + (confRank[a.confidence] || 1), 0) / withConf.length;
    let rank = avgRank >= 2.5 ? 3 : avgRank >= 1.5 ? 2 : 1;
    if (accessibilityCoverage < 0.5) rank = Math.max(1, rank - 1); // sparse evidence coverage -> less confident
    confidence = { 3: 'HIGH', 2: 'MEDIUM', 1: 'LOW' }[rank];
  }

  const reasons = [
    ...new Set(
      edges.flatMap((e) => {
        const acc = accessibilityMap.get(e.roadId);
        return computeEdgeCost(e, acc, 'NORMAL', 'BALANCED').reasons;
      })
    ),
  ];

  const geometry = buildRouteGeometry(graph, edgeSequence);
  const roadIds = edges.map((e) => e.roadId);
  const roadNames = [...new Set(edges.map((e) => e.roadName))];

  return {
    roadIds,
    roadNames,
    geometry,
    distanceKm,
    estimatedTravelMinutes,
    etaLabel: 'Estimated ETA (assumes ' + ASSUMED_SPEED_KMPH + 'km/h average — not based on live traffic or speed data)',
    riskScore,
    accessibilityScore,
    accessibilityCoverage,
    confidence,
    reasons,
  };
}

/**
 * Main entry point.
 * @param {object} params
 * @param {{lat:number, lng:number}} params.origin
 * @param {{lat:number, lng:number}} params.destination
 * @param {'NORMAL'|'IMPORTANT'|'EMERGENCY'} [params.cargoPriority]
 */
async function recommendRealRoute({ origin, destination, cargoPriority = 'NORMAL' }) {
  const graph = await getGraph();

  const originSnap = snapToNearestNode(graph, origin.lat, origin.lng, SNAP_MAX_DISTANCE_KM);
  const destinationSnap = snapToNearestNode(graph, destination.lat, destination.lng, SNAP_MAX_DISTANCE_KM);

  if (!originSnap) {
    return { matched: false, reason: 'NO_ROAD_NETWORK_COVERAGE', message: 'No real road network data near the origin location.', endpoint: 'origin' };
  }
  if (!destinationSnap) {
    return { matched: false, reason: 'NO_ROAD_NETWORK_COVERAGE', message: 'No real road network data near the destination location.', endpoint: 'destination' };
  }

  const originComponent = connectedComponent(graph, originSnap.nodeIndex);
  if (!originComponent.has(destinationSnap.nodeIndex)) {
    return {
      matched: false,
      reason: 'NO_CONNECTED_ROUTE',
      message:
        'Origin and destination are both within the imported road network, but no continuous connected path exists between them in the current dataset. See ROUTING_ARCHITECTURE.md for known coverage gaps.',
      originSnap,
      destinationSnap,
    };
  }

  const accessibilityMap = await computeEdgeAccessibilityMap(graph);

  const modes = [
    { key: 'SAFEST_FEASIBLE', cargoPriority: 'EMERGENCY', routeMode: 'BALANCED' },
    { key: 'BALANCED', cargoPriority, routeMode: 'BALANCED' },
    { key: 'SHORTEST_FEASIBLE', cargoPriority, routeMode: 'SHORTEST' },
  ];

  const routes = {};
  for (const mode of modes) {
    const costFn = buildCostFn(graph, accessibilityMap, mode.cargoPriority, mode.routeMode);
    const result = dijkstra(graph, originSnap.nodeIndex, destinationSnap.nodeIndex, costFn);
    routes[mode.key] = result ? { routeType: mode.key, ...summarizePath(graph, result, accessibilityMap) } : null;
  }

  // Deduplicate: if SAFEST and BALANCED (or SHORTEST) landed on the
  // identical road sequence, say so explicitly rather than presenting
  // two "different" cards that are actually the same route.
  const dedupNote = (a, b) =>
    a && b && JSON.stringify(a.roadIds) === JSON.stringify(b.roadIds) ? 'identical to' : null;

  return {
    matched: true,
    cargoPriority,
    originSnap,
    destinationSnap,
    routes,
    notes: {
      safestEqualsBalanced: Boolean(dedupNote(routes.SAFEST_FEASIBLE, routes.BALANCED)),
      balancedEqualsShortest: Boolean(dedupNote(routes.BALANCED, routes.SHORTEST_FEASIBLE)),
    },
  };
}

module.exports = { recommendRealRoute, ASSUMED_SPEED_KMPH, SNAP_MAX_DISTANCE_KM };
