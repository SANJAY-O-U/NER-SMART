# DATA_PROVENANCE.md — NER Smart Road Network (Phase 1)

This document records where every piece of REAL (non-demo) geospatial data
in the system came from, so nothing is ever presented as more official or
more current than it actually is.

## Road network — Guwahati → Imphal corridor

| Field | Value |
|---|---|
| **Dataset** | `INDIA_NATIONAL_HIGHWAY.geojson` |
| **Repository** | [`datta07/INDIAN-SHAPEFILES`](https://github.com/datta07/INDIAN-SHAPEFILES) |
| **Path in repository** | `INDIA/INDIA_NATIONAL_HIGHWAY.geojson` (branch `master`) |
| **Verified upstream commit** | `ca0fb2be45a5ce722a32831b1a9bee3213b11b25` (2025-06-05, "changed NH file") — the commit that last changed this file upstream |
| **Verified upstream git blob** | `5a2f31b661036853691f7486251c0c300a7e7847` |
| **Verified upstream SHA-256** | `f6c75e7686b50d52a8b61243f3dd8ae5c6b9f29d348416106fe871eda4497735` |
| **Verified upstream size** | 100,076,161 bytes (62,031 features) |
| **Discovered via** | [`yashveeeeeeer/india-geodata`](https://github.com/yashveeeeeeer/india-geodata), an open-data aggregator that indexes this dataset alongside official MoRTH/GatiShakti sources. This was only a pointer used to find the dataset; it is not evidence of the dataset's own origin (see "What this data is NOT"). |
| **License** | MIT. Upstream license text: [`backend/data/sources/LICENSE.datta07-INDIAN-SHAPEFILES.txt`](backend/data/sources/LICENSE.datta07-INDIAN-SHAPEFILES.txt); attribution: [`NOTICE.md`](NOTICE.md) |
| **Acquisition date** | 2026-09-15 (recorded by this project at acquisition; independently verified on 2026-10-02, see below) |
| **Geographic coverage extracted** | Features with any vertex inside `91.5°E–94.3°E, 24.5°N–26.3°N` — the Guwahati↔Imphal corridor |
| **Highways included** | NH 27 (Guwahati → Daboka), NH 29 (Daboka → Dimapur → Kohima → Jessami), NH 2 (Jessami/Karong → Imphal) |
| **Features imported** | 260 LineString segments (NH 27: 183, NH 29: 54, NH 2: 23) |
| **Transformation performed** | Feature subset only, by the verified extraction rule below. No feature, coordinate or property was altered, simplified, or generated. |
| **Local copy** | `backend/data/sources/nh_guwahati_imphal_corridor.geojson` (948,047 bytes, SHA-256 `36c1116bd9b8b12173a66caf6234cb3472baf287302cf36021af20f718d5f149`) |
| **Production `source` value** | `datta07/INDIAN-SHAPEFILES (MIT) — INDIA_NATIONAL_HIGHWAY.geojson` on all 260 roads (set 2026-10-02; before that the importer's placeholder `unspecified source (pass --source=)` was stored because `--source` had not been passed at import) |
| **Production `sourceVintage` value** | `null` on all 260 roads — intentionally; see "Vintage is UNKNOWN" below |

## Independent verification of the upstream identity (2026-10-02)

The upstream identity of the road data is **independently verified**, not
merely documented. On 2026-10-02 the complete upstream file was downloaded
from the public repository
(`https://raw.githubusercontent.com/datta07/INDIAN-SHAPEFILES/master/INDIA/INDIA_NATIONAL_HIGHWAY.geojson`)
into scratch space outside this repository, and:

- Its size (100,076,161 bytes) and its recomputed git blob hash
  (`5a2f31b661036853691f7486251c0c300a7e7847`) equal the values GitHub
  reports for that path; its SHA-256 is recorded in the table above. It is a
  `FeatureCollection` of 62,031 features with 62,031 unique `OBJECTID`s and
  no embedded metadata.
- **Exact feature subset.** Each of the 260 features in
  `nh_guwahati_imphal_corridor.geojson`, and each of the 260 road documents in
  the production database (`ner-smart-prod.roads`, matched through
  `sourceId` = `OBJECTID`), has an upstream feature with the same `OBJECTID`
  whose geometry type, coordinates and all properties are identical. There
  are no unmatched features. The 260-road dataset is therefore an exact
  feature subset of the upstream file.
- **Extraction rule reproduces exactly 260 features.** The rule is: road name
  is one of `NH 27`, `NH 29`, `NH 2` or `NH  27` (double space) **AND** *any
  vertex* of the feature lies inside longitude 91.5–94.3 and latitude
  24.5–26.3. Upstream holds 2,511 features with those names (`NH 27`: 2,239;
  `NH 2`: 183; `NH 29`: 88; `NH  27`: 1); the rule selects exactly the 260
  features of the corridor file — none missing, none extra. The `NH  27`
  variant contributes no feature to the 260. Stricter readings do not
  reproduce the file (all vertices inside the box: 254 features; middle
  vertex inside: 258). Because the rule keeps every feature that has at least
  one vertex inside the box, whole features are kept and the extracted
  geometry extends slightly beyond the box
  (longitude 91.6683–94.3862, latitude 24.3460–26.3136).
- **Upstream state.** The file was added upstream on 2022-02-21 (a different,
  31,796,424-byte version) and last changed on 2025-06-05 (commit
  `ca0fb2be45a5ce722a32831b1a9bee3213b11b25`, the version verified here). At
  verification time upstream `master` was at
  `08490eaab1b9bb4b55addfb1d2c742586c8d22e0` (2026-09-19) and had not
  changed this file since 2025-06-05, so the verified blob predates the
  recorded acquisition date of 2026-09-15.

To re-verify: download the file at that commit, compare its SHA-256 and git
blob hash with the values above, then match each `OBJECTID` of the corridor
file (or each production road's `sourceId`) to the upstream feature and
compare geometry and properties, and re-apply the extraction rule.

**What this does not establish:** when any road was surveyed or digitised, the
date of any individual feature, or where the upstream project obtained its data.

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
- **Vintage is UNKNOWN, and `sourceVintage` is intentionally null.** The
  upstream README states "Data Vintage: Primarily 2019 (with ongoing
  updates)" for the repository as a whole. The data does not timestamp
  individual features, and this particular file was replaced upstream on
  2025-06-05, so that statement does not establish the vintage of these
  roads. The 2025-06-05 commit date records when this version of the file
  appeared in the upstream repository, not when any road was mapped.
  Production `sourceVintage` is therefore `null` on all 260 roads, and must
  stay `null` until a documented vintage for this dataset exists. (An
  earlier version of this document said the vintage was recorded as
  `sourceVintage` on each road. That was not the case for the production
  roads: the importer's `--vintage` option was not used for that import, and
  all 260 production roads hold `null`.)
- **The upstream names no original data source.** Its README states none,
  and beyond the MIT licence it gives no attribution. This project makes no
  claim about the dataset's original or official origin, including any claim
  of MoRTH or PM GatiShakti provenance.
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
| Data vintage (per road or per dataset) | Unknown — `sourceVintage` is `null` on all 260 roads by design |
| Original (upstream-of-upstream) data origin | Not stated by the upstream repository; no claim is made |
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
