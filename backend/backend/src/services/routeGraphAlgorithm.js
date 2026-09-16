/**
 * Route Graph Algorithm
 * ----------------------
 * A plain, deterministic Dijkstra shortest-path implementation over the
 * graph built by roadGraphService.js. No AI, no heuristics baked in here
 * — the "risk-awareness" comes entirely from the edgeCostFn the caller
 * supplies (see routeCostService.js). This module only knows how to
 * find the minimum-cost path through a weighted graph.
 *
 * Pure and synchronous IF edgeCostFn is synchronous; routingEngineService.js
 * precomputes all edge costs asynchronously first (since cost depends on
 * the accessibility engine, which hits the DB) and passes a synchronous
 * lookup function in here — keeping this module itself trivially
 * testable with a synthetic graph and a fake cost function.
 */

/**
 * @param {object} graph - { nodes, edges, adjacency } from roadGraphService
 * @param {number} startNode
 * @param {number} endNode
 * @param {(edge: object) => { cost: number, blocked: boolean }} edgeCostFn
 * @returns {{ path: number[], edgeSequence: Array<{edgeIndex:number, direction:string}>, totalCost: number } | null}
 */
function dijkstra(graph, startNode, endNode, edgeCostFn) {
  if (startNode === endNode) {
    return { path: [startNode], edgeSequence: [], totalCost: 0 };
  }

  const dist = new Map([[startNode, 0]]);
  const prev = new Map(); // nodeIndex -> { fromNode, edgeIndex, direction }
  const visited = new Set();

  // Simple O(V^2) priority selection — the graph here is at most a few
  // hundred nodes (MVP corridor scope), so a binary heap is unnecessary
  // engineering overhead per the mission's anti-overengineering guidance.
  function extractMin() {
    let bestNode = null;
    let bestDist = Infinity;
    for (const [node, d] of dist.entries()) {
      if (!visited.has(node) && d < bestDist) {
        bestDist = d;
        bestNode = node;
      }
    }
    return bestNode;
  }

  while (true) {
    const current = extractMin();
    if (current === null) break; // no more reachable nodes
    visited.add(current);
    if (current === endNode) break;

    const neighbors = graph.adjacency.get(current) || [];
    for (const { neighborNode, edgeIndex, direction } of neighbors) {
      if (visited.has(neighborNode)) continue;
      const edge = graph.edges[edgeIndex];
      const { cost, blocked } = edgeCostFn(edge, direction);
      if (blocked) continue; // BLOCKED roads are excluded from traversal entirely, not just penalized

      const candidateDist = (dist.get(current) ?? Infinity) + cost;
      if (candidateDist < (dist.get(neighborNode) ?? Infinity)) {
        dist.set(neighborNode, candidateDist);
        prev.set(neighborNode, { fromNode: current, edgeIndex, direction });
      }
    }
  }

  if (!dist.has(endNode) || !visited.has(endNode)) {
    return null; // unreachable — including "wholly cut off by BLOCKED roads"
  }

  // Reconstruct path
  const path = [endNode];
  const edgeSequence = [];
  let node = endNode;
  while (node !== startNode) {
    const step = prev.get(node);
    if (!step) return null; // shouldn't happen if dist.has(endNode), but never crash
    edgeSequence.unshift({ edgeIndex: step.edgeIndex, direction: step.direction });
    path.unshift(step.fromNode);
    node = step.fromNode;
  }

  return { path, edgeSequence, totalCost: dist.get(endNode) };
}

module.exports = { dijkstra };
