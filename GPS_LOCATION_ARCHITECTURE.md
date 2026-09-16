# GPS_LOCATION_ARCHITECTURE.md — Live GPS + NER Demo Mode (Phase 4A)

## Location modes

Two explicit, user-selected modes — never silently substituted for each other:

| Mode | Source | UI label |
|---|---|---|
| **LIVE GPS** | Real device GPS via `geolocator` | `LIVE GPS` (green) |
| **NER DEMO** | One of 8 fixed demonstration locations, user-selected from a dropdown | `NER DEMO` (purple) + city/state name |

The active mode is always visible on the location status card in the report flow (`report_flow_screen.dart`), color-coded and labeled — never ambiguous about which one is active.

**Critical rule enforced in code:** `LocationService.getLiveGpsFix()` never falls back to demo data. On any failure (permission denied, service disabled, timeout, unknown error) it throws a `LocationException` with a specific reason code; the UI shows the error and a "Retry Live GPS" button. The user must explicitly tap the NER DEMO mode button to switch — the app never does it for them.

## NER demo locations

Real town coordinates (state capitals / major towns), defined in `location_service.dart`:

| City | State | Coordinates |
|---|---|---|
| Guwahati | Assam | 26.1445, 91.7362 |
| Imphal | Manipur | 24.8170, 93.9368 |
| Shillong | Meghalaya | 25.5788, 91.8933 |
| Aizawl | Mizoram | 23.7271, 92.7176 |
| Kohima | Nagaland | 25.6751, 94.1086 |
| Agartala | Tripura | 23.8315, 91.2868 |
| Itanagar | Arunachal Pradesh | 27.0844, 93.6053 |
| Gangtok | Sikkim | 27.3389, 88.6065 |

## GPS fields captured

`GpsFix` (`location_service.dart`): `lat`, `lng`, `accuracyMeters`, `speedMetersPerSecond`, `headingDegrees`, `timestamp`. Every field the platform doesn't actually provide is passed through as-is from `geolocator`'s `Position` object — never fabricated, never defaulted to a fake value. (Note: some platforms report `0.0` for genuinely-unavailable speed/heading rather than `null` — there is no reliable cross-platform way to distinguish "reported zero" from "unknown" at the `geolocator` API level; this is a known limitation, not something this app invents.)

## Permission handling

`getLiveGpsFix()` distinguishes and surfaces each failure mode with a specific message:

| Condition | `LocationErrorReason` | Message shown |
|---|---|---|
| Location services off | `serviceDisabled` | "Location services are turned off on this device..." |
| Permission denied (can re-ask) | `permissionDenied` | "Location permission is required to associate this report with a road." |
| Permission denied forever | `permissionDeniedForever` | "...Enable it in system settings..." |
| 12s timeout | `timeout` | "Timed out waiting for a GPS fix..." |
| Anything else | `unknown` | The underlying error message |

None of these crash the app — all surface as a retry-able error card in the form.

## GPS quality tiers

Mirrors the backend's `locationMatchService.js` thresholds exactly (`location_service.dart`'s `qualityTierForAccuracy`):

- **HIGH**: accuracy ≤ 20m
- **MEDIUM**: accuracy ≤ 100m
- **LOW**: accuracy > 100m
- **unknown**: accuracy not reported

These are documented engineering defaults, not a scientific claim. When accuracy is LOW, the UI shows: *"Low GPS accuracy — road association may be uncertain."*

## Backend nearest-road API

`GET /api/roads/nearest?lat={lat}&lng={lng}&accuracyMeters={accuracy}`

Uses the **same MongoDB 2dsphere query** as Phase 1's incident-association flow (`geoService.findNearestRoadGeo`) — no separate/manual coordinate scanning. NER DEMO mode calls this exact same endpoint with the chosen city's coordinates; only the coordinate source differs, never the matching logic.

**Response (matched):**
```json
{
  "matched": true,
  "road": { "id": "...", "name": "...", "state": "...", "district": "...", "corridor": "...", "geometry": {...} },
  "distanceMeters": 18,
  "gpsAccuracyMeters": 12.7,
  "confidence": "HIGH",
  "method": "MONGODB_2DSPHERE"
}
```

**Response (no match):**
```json
{ "matched": false, "reason": "NO_ROAD_WITHIN_THRESHOLD", "message": "Road network coverage unavailable for this location.", "confidence": "LOW" }
```

A `matched: false` response is a normal `200 OK` — it is NOT an error. A genuine backend/DB failure returns `503` with a distinct error message, and the Flutter client (`ApiService.getNearestRoad`) throws `ApiException` only in that case, so the UI never confuses "no road nearby" with "backend is down."

## Confidence algorithm

`locationMatchService.js` (backend) / mirrored display logic (Flutter). Confidence is the **weaker of two independent tiers** — road distance and GPS accuracy — never derived from distance alone once accuracy is known:

| Road distance | Tier |
|---|---|
| ≤ 50m | HIGH |
| ≤ 300m | MEDIUM |
| ≤ 15km | LOW |
| > 15km | NONE (no match returned) |

| GPS accuracy | Tier |
|---|---|
| ≤ 20m | HIGH |
| ≤ 100m | MEDIUM |
| > 100m | LOW |

**Combined = min(distance tier, GPS tier).** If GPS accuracy isn't supplied at all, confidence is capped at MEDIUM regardless of how close the road is — you cannot honestly call a match HIGH confidence without knowing how accurate the underlying fix was. Verified against the mission's own worked examples: 8m accuracy + 4m distance → HIGH; 150m accuracy + 5m distance → LOW (not HIGH).

These meter-scale thresholds are intentionally different from (and tighter than) Phase 1's `geoService.js` kilometer-scale thresholds, which serve the incident-report bridge, not real-time GPS matching — documented in `locationMatchService.js`.

## Mumbai / live-GPS behavior

The imported road network (Phase 1) only covers the Guwahati↔Imphal corridor. A LIVE GPS fix taken in Mumbai is ~2,000km from the nearest imported road — far beyond the 15km LOW threshold — so `findNearestRoadGeo` correctly returns no match, and the API responds `matched: false` with `"Road network coverage unavailable for this location."` **There is no special-case code for Mumbai** — this is the natural, honest behavior of the same distance-threshold logic used everywhere else. Switching to NER DEMO mode and picking a city then exercises the real corridor data.

## Privacy

No continuous location history is stored in this phase — GPS is only used at the moment of report submission and nearest-road lookup, never logged to a persistent tracking table. `console.log`/`print` statements in this phase do not print raw coordinates in production code paths.

## Known limitations

- Speed/heading may read as `0.0` instead of `null` on some platforms when genuinely unavailable — a `geolocator` limitation, not something this app can detect and correct.
- Continuous location streaming (for live vehicle tracking) is explicitly out of scope for this phase — see Phase 4B.
- Flutter native Android/iOS project scaffolding must still be generated locally via `flutter create .` (see `FLUTTER_SETUP.md`) — this sandbox has no Flutter SDK to verify a real build.
- Confidence thresholds (meters, tiers) are engineering defaults, not derived from a validated statistical study.
