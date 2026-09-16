# ROUTING_ARCHITECTURE.md — Risk-Aware Routing (Phase 4C)

## What replaced what

The Phase-0 hardcoded city-name route catalogue (`routingService.js`,
`POST /api/routes/recommend`) is **left in place, unchanged** — it still
backs the existing screening-demo UI and the landslide simulation's
road-name-based rerouting. Per this phase's Rule 1, it was not removed.

A new, **real**, graph-based engine was added alongside it:
`POST /api/routes/recommend-real`, taking `{lat,lng}` coordinates instead
of city name strings, and computing routes over the actual imported road
geometry rather than a lookup table.

## ROUTING_CORRIDOR_STATUS = NOT_READY (Guwahati ↔ Imphal specifically)

**Phase 4C.1 investigated the connectivity gap thoroughly and could not
close it with any real data source reachable from this environment.**
Guwahati and Imphal remain in different connected components. This
section documents the investigation; the original Phase 4C finding
below is preserved as context.

### Root cause, precisely identified

The gap is **not** a bounding-box, naming, or coordinate-handling
problem. It was isolated to a genuine ~50km stretch of NH 27 between
Guwahati and Nagaon (roughly 91.67°E–92.31°E, 26.10°N–26.30°N), where
the source dataset (`datta07/INDIAN-SHAPEFILES`, see
`DATA_PROVENANCE.md`) simply has **no digitized geometry at all** for
several sub-stretches. Four distinct gaps were measured directly
between real NH 27 segment endpoints in this stretch: two of ~7.5km,
two of ~1.6km — roughly 25-30km of missing road out of that ~50km
section. This matches investigation cause **(e): genuinely incomplete
source data** — not (a) missing geometry elsewhere, (b) a snapping
tolerance issue, (c) incorrect filtering, or (d) coordinate handling.

Verification steps taken (all confirm the same conclusion):
1. Re-extracted NH 27/29/2 nationwide (2,511 features, no bounding-box
   restriction) and re-tested connectivity — Guwahati's component size
   was **identical** (15 nodes) to the narrow-bbox version, proving the
   original bbox filter was not the cause.
2. Isolated just the 65 NH 27 segments within the gap region and tested
   snap tolerances from 111m to 8.9km directly — components only fully
   merge at ≥2.2km tolerance, which exceeds any defensible highway
   digitization precision.
3. Located the exact coordinates of each gap and searched the **entire**
   source dataset (all 62,031 features, every road classification, not
   just NH-named ones) for any geometry — under any name — within 300m
   of each gap endpoint. Found **nothing** bridging most gaps; the only
   nearby features were other NH 27 endpoints already accounted for.

### Real alternative sources attempted (all exhausted)

| Source | Result |
|---|---|
| Overpass API (`overpass-api.de`) | Blocked by the API's own `robots.txt` for the automated-fetch tool available in this environment |
| Bhuvan / ISRO GatiShakti | Requires registration (established in Phase 1) |
| Geofabrik whole-India extract (1.6GB `.osm.pbf`) | Domain blocked by this sandbox's network egress policy |
| Geofabrik **North-Eastern Zone** regional extract (104MB `.gpkg.zip`) — a genuinely appropriately-sized, legitimate option | Same domain block; and `.zip` binaries aren't retrievable through the available fetch tool even where a domain is reachable |

No fabricated bridge, synthetic geometry, or inflated snap tolerance was
introduced. Per this phase's explicit instruction, the honest outcome is
reported instead: this specific origin/destination pair is not
routable end-to-end over real, verified road geometry with data
available in this environment.

### What IS verified working

The real ~270km connected stretch of NH 27 found in Phase 4C (roughly
24.84°N–26.31°N) remains fully valid, tested, and routable — 38 real
segments, real geometry, real accessibility-aware cost. The routing
*engine* itself is proven correct; only this specific corridor's *data
coverage* is incomplete. `recommendRealRoute()` correctly returns
`{matched: false, reason: 'NO_CONNECTED_ROUTE'}` for Guwahati→Imphal —
this is the intended, correct behavior for a genuine data gap, not a
bug to suppress.

### Path to closing this gap (for a future phase, with real tool access)

Any of the following, performed from an environment that can actually
reach the source: (1) an Overpass query for `highway=trunk` ways
tagged `ref~"NH27"` in the gap bounding box; (2) downloading and
filtering the Geofabrik North-Eastern Zone `.osm.pbf`/`.gpkg` extract;
(3) contacting NHAI/MoRTH directly for the authoritative alignment.

## Important, honest finding: the current dataset is not one connected graph

Before building the pathfinder, the actual connectivity of the 260
imported road segments (see `DATA_PROVENANCE.md`) was tested
programmatically at several snapping tolerances:

| Snap tolerance | Connected components | Guwahati ↔ Imphal connected? |
|---|---|---|
| 50m | 17 | No |
| 111m | 16 | No |
| 222m | 12 | No |
| 555m | 11 | No |
| 1.1km | 9 | No |
| 2.2km | 5 | No |

**At no defensible tolerance do Guwahati and Imphal fall in the same
connected component.** This is a real gap in the currently-imported
260-segment extract (see `DATA_PROVENANCE.md` for how it was sourced and
filtered) — not a bug in the graph-construction code, and not something
this phase works around by fabricating connectivity.

The largest connected component (76 nodes, 75 edges, using the
production 300m snap tolerance) spans roughly **24.84°N–26.31°N along
NH 27** — a genuine, real, continuously-connected ~270km stretch. Two
real points on this stretch (the component's southernmost and
northernmost node coordinates) are used as the default example in the
dashboard's "Real Road Network" routing UI and in tests, rather than
asserting Guwahati/Imphal connectivity that doesn't exist yet.

**When origin and destination snap to different components**, the API
returns `matched: false, reason: 'NO_CONNECTED_ROUTE'` — this is
correct, intended behavior (see acceptance test #18 "no valid route"),
not an error to suppress.

## Graph construction

`roadGraphService.js`, pure function `buildGraphFromRoads()`:

- Each road document with real `geometry` (LineString/MultiLineString)
  becomes **one edge** — not sub-split into every intermediate vertex,
  per the mission's explicit instruction.
- A road's first and last coordinate become its two endpoint nodes.
- Endpoints within **300m** (`0.003°`, `DEFAULT_SNAP_TOLERANCE_DEG`) of
  an existing node are merged into it — a documented engineering
  default for snapping independently-digitized highway segments,
  **not** derived from a survey of this specific dataset's digitization
  precision.
- MultiLineString geometries are flattened into one continuous path for
  graph purposes (a documented simplification — internal breaks within
  a single road's MultiLineString aren't modeled as separate nodes).
- The graph is undirected (a road can be driven either direction).

## Origin/destination snapping

`snapToNearestNode(graph, lat, lng, maxDistanceKm=20)` — finds the
nearest graph node, but **returns `null`** (never snaps) beyond 20km.
This is what makes the Phase 4A Mumbai-does-not-become-NER behavior
extend correctly into routing: a Mumbai coordinate is ~2,000km from any
graph node, so it never snaps, and the API reports
`NO_ROAD_NETWORK_COVERAGE` rather than fabricating a nearby match.

## Routing algorithm

`routeGraphAlgorithm.js` — a plain Dijkstra implementation, O(V²)
priority selection (a binary heap was judged unnecessary engineering
overhead for a few-hundred-node MVP-scope graph, per the mission's
anti-overengineering guidance). No AI anywhere in this module — same
input always produces the same output.

**A real bug was found and fixed during this phase**: the original
implementation marked the destination node `visited` only *after*
checking whether to stop, so reaching the destination via the very last
step incorrectly returned "no route found" even when a valid path
existed. Fixed by moving the `visited.add()` before the stop check;
verified against both a synthetic test graph and the real 260-segment
corridor (a genuine ~271km, 38-segment route was found end-to-end after
the fix).

## Cost function (`routeCostService.js`)

```
routeCost = travelCost + statePenalty×cargoWeight + riskScorePenalty×cargoWeight
```

| State | Base penalty (cost-km equivalent) |
|---|---|
| OPEN | 0 |
| RESTRICTED | 15 |
| HIGH_RISK | 40 |
| UNKNOWN | 10 |
| BLOCKED | excluded entirely (`cost: Infinity, blocked: true`) — never just penalized |

Cargo-priority weight multipliers (documented heuristics, configurable):

| Priority | riskWeight | unknownPenaltyWeight | restrictionWeight |
|---|---|---|---|
| NORMAL | 1.0 | 1.0 | 1.0 |
| IMPORTANT | 1.8 | 1.5 | 0.7 |
| EMERGENCY | 2.5 | 2.0 | 0.3 |

**BLOCKED is never overridden by cargo priority** — the exclusion
happens before any weight is applied, verified by a dedicated test.
EMERGENCY cargo is *more* tolerant of RESTRICTED roads (lower
`restrictionWeight`, since emergency shipments may have legitimate
access) but *more averse* to HIGH_RISK roads (higher `riskWeight`) and
*more* averse to UNKNOWN roads (prefers known-safe over unknown, per
the mission's explicit instruction).

`SHORTEST` mode zeroes out all risk/state penalties (distance only) but
**still excludes BLOCKED roads** — "shortest feasible," never "shortest
regardless of closure."

## Accessibility integration

Routing **never** recomputes accessibility itself. `routingEngineService.js`
calls `accessibilityService.computeAccessibilityForRoad()` (Phase 4B,
unchanged) once per edge, per request — not cached long-term, so an
expiring SACHET alert changes route costs on the very next request, per
the mission's "must be able to change" requirement. For the current
corridor-sized graph (a few hundred edges) this per-request cost is
acceptable; see Performance below for the scaling note.

## Route alternatives

Three genuinely different alternatives per request, not three arbitrary
paths:

- **SAFEST_FEASIBLE**: computed with EMERGENCY-level risk weighting
  *regardless* of the requested cargo priority — the actual safest
  possible path.
- **BALANCED**: computed with the *requested* cargo priority's weights
  — this is "the" recommendation for that shipment.
- **SHORTEST_FEASIBLE**: distance only, BLOCKED still excluded.

If two modes land on the identical road sequence, the response says so
explicitly (`notes.safestEqualsBalanced` / `notes.balancedEqualsShortest`)
rather than presenting two visually-different cards for the same route.

## ETA

`estimatedTravelMinutes = distanceKm / 35 km/h × 60`. **35 km/h is a
documented, conservative assumption** for NER hill/highway corridor
roads — not derived from any speed or traffic data source (none exists
in this project). Every response labels this explicitly:
`"Estimated ETA (assumes 35km/h average — not based on live traffic or
speed data)"`. No traffic data is fabricated anywhere in this pipeline —
`computeEdgeCost()`'s signature structurally has no traffic or weather
parameter at all.

## Route confidence

Distinct from route risk (a route can be low-risk and low-confidence).
Computed from the rank-averaged `confidence` of each traversed edge's
accessibility result, **discounted one tier if accessibility coverage
across the route is below 50%** (i.e., more than half the edges have no
real evidence at all) — sparse data coverage should reduce confidence
even if the known parts look safe.

## API

```
POST /api/routes/recommend-real
{ "origin": {"lat":..,"lng":..}, "destination": {"lat":..,"lng":..}, "cargoPriority": "NORMAL"|"IMPORTANT"|"EMERGENCY" }
```

Responses: `matched:false` with `reason: 'NO_ROAD_NETWORK_COVERAGE'`
(endpoint too far from any real road) or `'NO_CONNECTED_ROUTE'`
(both endpoints on the real network, but not connected in the current
dataset) — or `matched:true` with `routes.SAFEST_FEASIBLE` /
`.BALANCED` / `.SHORTEST_FEASIBLE`, each with `distanceKm`,
`estimatedTravelMinutes`, `etaLabel`, `riskScore`, `accessibilityScore`,
`accessibilityCoverage`, `confidence`, `reasons[]`, and real `geometry`.

## Dashboard / Map

`RouteRecommendationCard.jsx` gained a **Demo / Real Road Network**
toggle — the existing city-name flow is untouched; the new mode takes
coordinates and cargo priority, and renders all three alternatives with
their reasons. `MapView.jsx` gained an optional `routeGeometry` prop
that draws the selected real route as a distinct dashed purple polyline
using **actual road geometry** — never a synthetic straight line between
origin and destination.

## Performance

Graph topology is cached in-process for 10 minutes (`roadGraphService.js`,
`CACHE_TTL_MS`) — road geometry changes only on a manual re-import, so
this is safe. Per-edge **accessibility** is deliberately *not*
long-cached (must reflect current SACHET/evidence state on every
request). For the current corridor-sized graph (~130-260 edges) this is
an acceptable per-request cost. If the graph grows to cover more NER
corridors, the accessibility-per-edge step should be optimized to only
touch edges plausibly on a candidate route (e.g., a bounding-box
pre-filter, or an A* search that only evaluates edges as it explores
them) rather than every edge up front — flagged here as the concrete
next optimization, not implemented now to avoid over-engineering ahead
of an actual need.

## Known limitations

| Limitation | Status |
|---|---|
| Guwahati↔Imphal full graph connectivity | Not present in the current 260-segment extract — see finding above |
| All-8-state routing | Not attempted — current corridor only, per this phase's explicit scope |
| Real speed/traffic data | None exists — ETA is a labeled, documented assumption |
| Snap tolerance | Engineering default (300m), not derived from a digitization-precision survey |
| Accessibility-per-edge cost at scale | Acceptable now; needs optimization if the graph grows substantially (see Performance) |
