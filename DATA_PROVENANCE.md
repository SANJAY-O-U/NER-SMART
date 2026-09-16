# DATA_PROVENANCE.md — NER Smart Road Network (Phase 1)

This document records where every piece of REAL (non-demo) geospatial data
in the system came from, so nothing is ever presented as more official or
more current than it actually is.

## Road network — Guwahati → Imphal corridor

| Field | Value |
|---|---|
| **Dataset** | `INDIA_NATIONAL_HIGHWAY.geojson` |
| **Repository** | [`datta07/INDIAN-SHAPEFILES`](https://github.com/datta07/INDIAN-SHAPEFILES) |
| **Discovered via** | [`yashveeeeeeer/india-geodata`](https://github.com/yashveeeeeeer/india-geodata), an open-data aggregator that indexes this dataset alongside official MoRTH/GatiShakti sources |
| **License** | MIT (see the source repo's `LICENSE` file) |
| **Acquisition date** | 2026-09-15 |
| **Geographic coverage extracted** | Bounding box `91.5°E–94.3°E, 24.5°N–26.3°N` — the Guwahati↔Imphal corridor |
| **Highways included** | NH 27 (Guwahati → Daboka), NH 29 (Daboka → Dimapur → Kohima → Jessami), NH 2 (Jessami/Karong → Imphal) |
| **Features imported** | 260 LineString segments |
| **Transformation performed** | Filtered the national (~62,000-feature, ~100MB) dataset down to the four highway names (`NH 27`, `NH 29`, `NH 2`, and a stray `NH  27` double-space variant) whose geometry falls inside the corridor bounding box. No coordinates were altered, simplified, or generated. |
| **Local copy** | `backend/data/sources/nh_guwahati_imphal_corridor.geojson` |

### ⚠️ Important — what this data is NOT

- **This is not an official Government of India GIS feed.** It is a
  community-compiled GeoJSON export. The aggregator site notes the
  underlying MoRTH/GatiShakti data exists in official form (via
  [Bharatmaps](https://bharatmaps.gov.in/)), but Phase 1 uses the
  community GeoJSON export because it is small enough to work with
  directly and required no additional credentials — the official
  GatiShakti exports are large binary formats (Parquet/PMTiles) meant for
  GIS tooling, not something to hand-parse in an MVP's first phase.
- **No closure/accessibility status is included.** The source dataset
  carries a road's geometry and its highway number/class — nothing else.
  Every imported road's `physicalStatus`, `officialStatus`, and
  `fieldStatus` are set to `UNKNOWN` and must stay that way until a real
  status source (field reports, the future accessibility engine, or an
  official feed) says otherwise. The UI renders `UNKNOWN` as neutral gray
  with a dashed line — never green ("open") by default.
- **Data vintage is approximate.** The source repository documents its
  data as "primarily 2019, with ongoing updates" and does not timestamp
  individual features. We record this as `sourceVintage` on each road
  rather than inventing a precise date.
- **No `state`/`district` attribution.** The source properties
  (`OBJECTID`, `Name`, `Road_Type`, `Class_Code`, `Lane`, `Oneway`,
  elevation/shape fields) do not include administrative boundaries. Those
  fields are left `null` on every imported road rather than guessed —
  populating them properly requires a point-in-polygon join against a
  real district-boundary dataset, which is out of scope for Phase 1.
- **Geometry confidence is 0.8, not 1.0.** This reflects that the data is
  community-compiled rather than sourced directly from an authoritative
  government API — see `geometryConfidence` on each imported `Road`
  document.

### Official alternative (not used in Phase 1, for future reference)

The Ministry of Road Transport and Highways publishes the same network
(plus toll plazas and logistics parks) via PM GatiShakti, mirrored at
`yashveeeeeeer/india-geodata` under `data/infrastructure/national-highways/`
(release tag `infra/national-highways`) in Parquet/PMTiles/GeoJSONL
formats, CC0-1.0 licensed. If a future phase needs stronger provenance or
national coverage beyond this corridor, switch the import source there —
the `scripts/importRoadNetwork.js` importer already accepts any
GeoJSON FeatureCollection with a `Name`-bearing LineString/MultiLineString
per feature, so switching sources does not require rewriting the pipeline,
only re-running the import against the new file.

## Historical highway-numbering note

Wikipedia's official National Highway articles (accessed 2026-09-15)
confirm the real Guwahati↔Imphal route runs **NH 27 → NH 29 → NH 2** via
Daboka, Dimapur, and Kohima — not "NH-2 Guwahati-Imphal Highway" as the
original screening-demo seed data named it (that name was a prototype
placeholder, not a real designation; current NH 2 actually runs
Dibrugarh↔Tuipang through Nagaland/Manipur/Mizoram and only touches the
Guwahati–Imphal corridor at its Nagaland/Manipur end). The screening
demo's prototype road names are left unchanged in `seed.js` (they are
clearly demo data, `source: null`), but this correction is recorded here
so nobody mistakes the old prototype name for a verified highway
designation going forward.

## MongoDB indexing

- `Road.geometry` has a `2dsphere` index (declared in `src/models/Road.js`).
- Could not be verified as *created* in this environment — the sandbox
  used to build this feature cannot reach the project's MongoDB Atlas
  cluster (network egress is restricted to package registries and GitHub
  only). Mongoose creates the index automatically on first connection in
  a normal environment; run `db.roads.getIndexes()` after starting the
  backend locally to confirm it exists.

## Limitations summary

| Limitation | Status |
|---|---|
| Official government API access (Bhuvan/GatiShakti direct) | Not attempted — no credentials, and the raw formats are heavier than an MVP first phase needs |
| Road closure/accessibility status | Not available from this source — all imported roads are `UNKNOWN` |
| State/district attribution | Not available from this source — left `null` |
| Coverage beyond the Guwahati–Imphal corridor | Not imported yet — architecture supports it (see "second corridor" note below) |
| Live/DB integration testing of the import script | Not possible in the sandbox this was built in (no MongoDB Atlas access) — validated the full 260-feature dataset against the import script's validation logic instead (0 invalid features), and unit-tested the validation/confidence logic directly |

## Second corridor (documented choice, not yet imported)

Per the mission doc's instruction to choose and document a second
corridor once the first is working: **NH 6 (Silchar–Aizawl)** is the
recommended next corridor. It's already referenced in the screening-demo
seed data (`NH-6 Silchar-Aizawl Road`), the same source dataset already
contains it (61–147 segments were seen for `NH 6`/`NH 8`/`NH 37` in the
broader NER bounding box during Phase 1 filtering), and it connects a
different pair of NER states (Assam–Mizoram) than the first corridor
(Assam–Nagaland–Manipur), giving the eight-state expansion a second
distinct region to validate against before generalizing further.

## Phase 4C.1 addendum: Guwahati↔Imphal connectivity gap investigation

A dedicated investigation (see `ROUTING_ARCHITECTURE.md` for full
detail) traced the road-graph disconnection between Guwahati and Imphal
to a genuine ~50km digitization gap in this same source dataset, between
Guwahati and Nagaon (91.67°E–92.31°E, 26.10°N–26.30°N) — confirmed by
exhaustively searching all 62,031 features in the full national dataset
(every road classification, not just NH 27/29/2) for any bridging
geometry near the exact gap coordinates, and finding none.

**No new source was successfully acquired** to close this gap.
Attempted and exhausted: Overpass API (blocked by its own `robots.txt`
for the available fetch tool), Bhuvan/GatiShakti (requires
registration), and Geofabrik's whole-India and North-Eastern-Zone OSM
extracts (domain blocked by this environment's network policy; `.zip`
binaries aren't retrievable through the available fetch tool even where
reachable). `ROUTING_CORRIDOR_STATUS = NOT_READY` for this specific
origin/destination pair as a result — recorded here rather than worked
around with a larger snap tolerance or synthetic geometry.
