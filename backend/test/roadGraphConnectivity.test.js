const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildGraphFromRoads, snapToNearestNode, connectedComponent, DEFAULT_SNAP_TOLERANCE_DEG } = require('../src/services/roadGraphService');

const CORRIDOR_PATH = path.join(__dirname, '../data/sources/nh_guwahati_imphal_corridor.geojson');
const corridorData = JSON.parse(fs.readFileSync(CORRIDOR_PATH, 'utf8'));
const roads = corridorData.features.map((f, i) => ({ id: `r${i}`, name: f.properties.Name, geometry: f.geometry }));

const GUWAHATI = { lat: 26.1445, lng: 91.7362 };
const IMPHAL = { lat: 24.817, lng: 93.9368 };

/**
 * Phase 4C.1 investigation result: at the production snap tolerance
 * (300m — and every other tolerance tested from 50m to 2.2km, see
 * ROUTING_ARCHITECTURE.md), Guwahati and Imphal are NOT in the same
 * connected component of the currently-imported 260-segment corridor.
 * This was traced to a genuine ~50km digitization gap in the source
 * dataset between Guwahati and Nagaon (multiple sub-gaps of 1.5-7.5km),
 * confirmed by checking for ANY bridging geometry — of any road name or
 * classification — in the same source, which found nothing. No
 * alternative real data source could be reached from this sandbox
 * (Overpass blocked by robots.txt, Bhuvan/GatiShakti requires
 * registration, Geofabrik blocked in the bash sandbox and its zip
 * files aren't fetchable via the web_fetch tool).
 *
 * ROUTING_CORRIDOR_STATUS = NOT_READY for Guwahati<->Imphal specifically.
 *
 * This test asserts the CURRENT honest state. If it ever starts
 * failing because Guwahati and Imphal ARE connected, that means the
 * corridor dataset has genuinely improved — update this test's
 * expectation (and ROUTING_CORRIDOR_STATUS) at that point, don't treat
 * the failure as a regression to "fix" by loosening tolerance.
 */
test('REGRESSION CANARY: Guwahati and Imphal are NOT yet in the same connected component (documented real data gap, not a bug)', () => {
  const graph = buildGraphFromRoads(roads); // production default tolerance
  const gwSnap = snapToNearestNode(graph, GUWAHATI.lat, GUWAHATI.lng, 20);
  const imSnap = snapToNearestNode(graph, IMPHAL.lat, IMPHAL.lng, 20);
  assert.ok(gwSnap, 'Guwahati should still snap to the real network (it is near NH27)');
  assert.ok(imSnap, 'Imphal should still snap to the real network (it is near NH2)');

  const gwComponent = connectedComponent(graph, gwSnap.nodeIndex);
  assert.equal(
    gwComponent.has(imSnap.nodeIndex),
    false,
    'Guwahati and Imphal are connected now — update ROUTING_CORRIDOR_STATUS to READY and revise this test'
  );
});

test('the largest connected component in the current corridor covers a real, substantial stretch (not trivially small)', () => {
  const graph = buildGraphFromRoads(roads);
  const seen = new Set();
  let largest = null;
  for (let i = 0; i < graph.nodes.length; i += 1) {
    if (seen.has(i)) continue;
    const comp = connectedComponent(graph, i);
    for (const n of comp) seen.add(n);
    if (!largest || comp.size > largest.size) largest = comp;
  }
  assert.ok(largest.size >= 50, `expected a substantial connected component, got ${largest.size} nodes`);
});

test('increasing snap tolerance to an indefensible value (multiple km) is NOT how this gap should be closed — documented as a rejected approach', () => {
  // This test exists to make the decision explicit and testable: at a
  // tolerance large enough to bridge the real gaps, connectivity DOES
  // technically improve — but that tolerance (>1.6km) exceeds any
  // defensible real-world highway digitization precision, so Phase
  // 4C.1 deliberately did NOT adopt it. Documented here so a future
  // change to DEFAULT_SNAP_TOLERANCE_DEG that quietly does this gets
  // caught.
  assert.ok(
    DEFAULT_SNAP_TOLERANCE_DEG < 0.01,
    'production snap tolerance must stay well under ~1km — do not inflate it to manufacture connectivity'
  );
});

test('Mumbai still correctly fails to snap to this real corridor network (unrelated sanity check, unaffected by the gap)', () => {
  const graph = buildGraphFromRoads(roads);
  const mumbaiSnap = snapToNearestNode(graph, 19.076, 72.8777, 20);
  assert.equal(mumbaiSnap, null);
});
