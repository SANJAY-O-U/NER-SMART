# NOTICE — third-party material

This file lists third-party material that is redistributed inside this
repository and the licence terms it comes with. It covers third-party
material only: it neither grants nor declares a licence for NER-SMART's own
source code.

## Road network data — `datta07/INDIAN-SHAPEFILES`

| | |
|---|---|
| **Material** | `backend/data/sources/nh_guwahati_imphal_corridor.geojson` — 260 road features (NH 27, NH 29, NH 2) |
| **Taken from** | `INDIA/INDIA_NATIONAL_HIGHWAY.geojson` in <https://github.com/datta07/INDIAN-SHAPEFILES> |
| **Upstream revision** | commit `ca0fb2be45a5ce722a32831b1a9bee3213b11b25`, git blob `5a2f31b661036853691f7486251c0c300a7e7847` |
| **Modification** | Feature subset only (extraction rule documented in [DATA_PROVENANCE.md](DATA_PROVENANCE.md)). No feature was altered: geometry and properties are identical to upstream. |
| **Licence** | MIT |
| **Licence text** | [backend/data/sources/LICENSE.datta07-INDIAN-SHAPEFILES.txt](backend/data/sources/LICENSE.datta07-INDIAN-SHAPEFILES.txt) — a byte-for-byte copy of the upstream `LICENSE` file (fetched 2026-10-02) |

The upstream licence file's copyright line reads, exactly:

```
Copyright (c) 2022
```

The upstream file names no copyright holder, and none is named or implied
here. The MIT licence requires that its copyright notice and permission
notice be included in all copies or substantial portions of the material;
that is the purpose of the licence-text file above, which must stay next to
the data file.

### What this notice does not claim

- This is a community-compiled dataset, **not** an official government
  data feed. The upstream repository names no original data source, and
  this project makes no claim about the dataset's original or official
  origin (including any claim of MoRTH or PM GatiShakti provenance).
- The exact survey or digitisation date of any road feature is unknown.
  The upstream README states "Data Vintage: Primarily 2019 (with ongoing
  updates)" for the repository as a whole only.

Full provenance, the verification procedure and its results are in
[DATA_PROVENANCE.md](DATA_PROVENANCE.md).
