# SACHET_INTEGRATION.md — NDMA Disaster Alert Ingestion (Phase 3B)

## Access status

**`SACHET_ACCESS = VERIFIED`** for the national RSS feed and CAP 1.2 detail endpoint — both confirmed live during Phase 3A with real current alerts and zero credentials required. The polygon geometry endpoint (`FetchPolygonXMLFile`) is **blocked** (bot detection) and is **not used** anywhere in this implementation.

## Endpoints used

| Endpoint | Purpose |
|---|---|
| `GET https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml` | List of current national alerts (ETag-cacheable) |
| `GET https://sachet.ndma.gov.in/cap_public_website/FetchXMLFile?identifier={id}` | Full CAP 1.2 detail for one alert |

No authentication, no API key, no IP whitelist required for either — confirmed by direct requests in Phase 3A.

## Pipeline

```
RSS feed (ETag-cached)
  → coarse NER pre-filter (state names / IMD-city senders in title+author)
  → CAP 1.2 detail fetch per candidate
  → LGD district code match (primary) + areaDesc text match (fallback)
  → isRelevantToNer flag
  → persist (upsert by cap:identifier, dedup-safe)
  → district-level road association (see below)
  → disaster risk contribution (explainable heuristic)
  → GET /api/sachet/alerts, GET /api/sachet/road/:roadId
```

## NER district matching

`backend/src/config/nerGeography.js` holds real LGD (Local Government Directory) district codes for 7 of 8 NER states, sourced from a 2020-dated `lgdirectory.gov.in` export and cross-checked against codes observed live in real SACHET alerts during Phase 3A (Dimapur=244, Kohima=245, Phek=248, Peren=613 all matched exactly).

**Known gaps, not silently worked around:**
- Districts created after ~2020 are missing (confirmed: a live alert referenced "Chumoukedima", LGD 764, absent from the table — falls back to areaDesc text matching, which also doesn't catch it since it's not in our name list either).
- Tripura has no numeric LGD codes in the sources found — matched by district name only.

## Road association — district-level, not polygon

Because the polygon endpoint is blocked, association is **district-level only**, exactly as instructed: `associationMethod` is always `LGD_DISTRICT_MATCH`, `AREADESC_TEXT_MATCH`, or `NEAREST_DISTRICT_HQ_APPROXIMATION` — never `PRECISE_HAZARD_BOUNDARY`.

A further real limitation: Phase 1's road import left every road's `district` field `null` (no district-boundary join was available then). `scripts/backfillRoadDistricts.js` assigns an **approximate** district to each real road via nearest-district-HQ distance (real town coordinates, e.g. Guwahati, Dimapur, Kohima, Imphal) — explicitly labeled `NEAREST_DISTRICT_HQ_APPROXIMATION`, not a polygon join. Run it after `import:roads`:

```bash
npm run import:roads -- data/sources/nh_guwahati_imphal_corridor.geojson --corridor="Guwahati-Imphal" --source="datta07/INDIAN-SHAPEFILES (MIT)"
npm run backfill:districts
```

## Accessibility state — unchanged by design

A SACHET alert **never** sets a road's `physicalStatus`/`officialStatus`/`fieldStatus` to `BLOCKED` (or anything else). It only contributes a `disasterRiskContribution` score and appears in that road's disaster context. Closure status still requires separate, explicit evidence — this distinction is enforced structurally (the association/persistence code never writes to those Road fields at all).

## Disaster risk contribution

A documented heuristic (`disasterRiskAdapter.js`), not a trained model: CAP's own ordered `severity`/`urgency`/`certainty` enumerations are linearized 0-1 and combined with configurable weights (50/30/20). Every score ships with a per-factor explanation (`{factor, contribution, source, rawValue}`). Never call this ML or cite an accuracy figure.

## ETag / freshness

Implements SACHET's own documented ETag mechanism: stores the `ETag` header from each 200 response, sends `If-None-Match` on the next request, treats `304` as "no new alerts, don't reprocess." The ETag store is in-memory (resets on restart — worst case is one extra full fetch, not incorrect data).

`SACHET_POLL_INTERVAL_MINUTES` (default 15, set to `0` to disable) controls automatic polling in `server.js`.

## Failure isolation

- RSS fetch failure → `UNAVAILABLE`, registered in the data source registry, no crash.
- One bad CAP alert (malformed XML, network error) → skipped, logged, rest of the batch still processes.
- One bad alert at persist time → skipped, logged, rest of the batch still persists.

## Tests

50 new tests (106 total across all phases): RSS parsing (incl. single-item and malformed-item edge cases), CAP 1.2 parsing against the real fixture captured in Phase 3A (severity/urgency/certainty/timestamps/LGD codes/NER relevance), NER geography matching, ETag/304 behavior (mocked), one-bad-alert isolation, disaster risk weighting/explainability. Zero live SACHET calls in the test suite.

**Not testable in this sandbox** (no MongoDB Atlas access, consistent with Phases 1-2): `sachetRoadAssociation.js`'s actual `Road.find()` query, `sachetController.js`'s dedup/upsert/lifecycle logic (`persistAlert`, `expireOldAlerts`). These are straightforward given the (fully tested) building blocks they call, but should be verified against a real database before relying on them.

## Limitations summary

| Item | Status |
|---|---|
| RSS + CAP detail access | ✅ Verified live, no credentials |
| Polygon geometry | ❌ Blocked — not used anywhere |
| LGD district codes | ⚠️ 7/8 states, 2020-dated, missing newer districts |
| Tripura LGD codes | ❌ Not found — name-matching only |
| Road → district assignment | ⚠️ Nearest-HQ approximation, not a polygon join |
| ETag mechanism | ✅ Implemented per official docs; header-level behavior not independently observed (see Phase 3A audit) |
