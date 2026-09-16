# IMD_INTEGRATION.md — Weather Data Integration (Phase 2)

## Access status

**`IMD_ACCESS = NOT_VERIFIED`**

Verified directly (2026-09-15):

- `GET https://api.imd.gov.in/api/v1/current_wx?id=42314` → **HTTP 401**
- `GET https://api.imd.gov.in/api/v1/sunmoon?lat=26.1445&lon=91.7362` → **HTTP 401**

The API is real and reachable — it responds with an authentication
error, not a connection failure — confirming it requires credentials for
every endpoint tested, including ones that look like they might be
public (astronomical rise/set times).

**Registration is gated.** `https://api.imd.gov.in/public/register.php`
states:

> "If you are registering for a government organization, you must use
> your official email address ending with **gov.in**, **nic.in**,
> **cdot.in**, **cdac.in**, **nhai.org** and **icar.org.in**."

No path is offered for a college team or independent developer without
one of those institutional domains. This project's team has no such
email, so **credentials cannot be obtained through self-service
registration for this project.** Obtaining access would require the
college or a sponsoring government body to request an account through
IMD's contact channels (listed on the portal) — not something achievable
during a hackathon-scale project.

Per the mission's instruction for this situation, the live-integration
portion was stopped, and only the provider interface + normalization,
built against IMD's own documented response formats, was implemented.

## Exact verified endpoints (from the official public API reference)

Source: `https://api.imd.gov.in/public/api_reference.html` (fetched
2026-09-15 — publicly viewable without login; only the actual data calls
require auth).

Endpoints modeled in this integration:

| Endpoint | URL pattern | Used for |
|---|---|---|
| Current Weather API | `GET /api/v1/current_wx?id={stationId}` | Station point observations: temperature, humidity, wind, 24hr rainfall, weather code |
| AWS/ARG Data | `GET /api/v1/aws_data?id={stationId}` (or `?sid={stateId}`) | Same as above, but includes station Latitude/Longitude directly — preferred for spatial association |
| District-wise Warnings | `GET /api/v1/districtwarning?id={districtId}` | 5-day warning codes per district (heavy rain, thunderstorm, etc.) |

28 endpoints total exist (forecasts, cyclone tracking, marine bulletins,
NHAI highway warnings, radar, lightning, etc.) — only the three above
were modeled, because they're the ones that map onto the existing risk
engine's inputs (rainfall, wind) and the road-association use case. The
**NHAI Highway Nowcast/5-Day Warning APIs** (`#api-21`, `#api-22`) are
worth prioritizing in a future phase — they're purpose-built for exactly
this project's use case (road-specific weather warnings) and weren't
modeled here only because scope was kept to the three general-purpose
endpoints for this first pass.

## Authentication mechanism — UNVERIFIED ASSUMPTION

The public API reference documents endpoint URLs and response shapes
only; the exact request-time auth mechanism (header name, query param,
or IP-whitelist-only with no key) is not shown without logging into the
portal. This integration assumes an `Authorization: Bearer {key}` header,
configurable via environment variables:

```
IMD_API_BASE_URL=https://api.imd.gov.in/api/v1
IMD_API_KEY=
IMD_API_AUTH_HEADER=Authorization
IMD_API_AUTH_SCHEME=Bearer
```

**This must be corrected once real credentials are issued** — the portal
also mentions IP whitelisting separately ("For IP Whitelisting click
here"), suggesting the actual mechanism may combine a server IP allowlist
with the API key, not just a bearer token. `weatherService.js` isolates
all auth-header construction in one function (`buildAuthHeaders()`) so
this is a one-function fix when the real mechanism is known.

## Weather fields obtained (once credentials exist)

Normalized into `WeatherObservation` (see `src/models/WeatherObservation.js`):

| Our field | From `current_wx` | From `aws_data` | Notes |
|---|---|---|---|
| `temperatureC` | `Temperature` | `CURR_TEMP` | °C, as documented |
| `humidityPct` | `Humidity` | `RH` | % |
| `rainfallMm` | `Last 24 hrs Rainfall` | *(not provided)* | mm, 24hr trailing window |
| `windSpeedKmph` | `Wind Speed` | `WIND_SPEED` | km/h |
| `windDirectionDeg` | `Wind Direction` | `WIND_DIRECTION` | degrees, coded per IMD's direction table |
| `weatherCondition` | `Weather Code` (decoded) | `WEATHER_CODE` (decoded) | mapped via `decodeWeatherCode()` — only ranges relevant to road risk are named (rain/thunderstorm/fog/duststorm/snow); everything else is passed through as `IMD_CODE_{n}` rather than guessed |
| `location` | *(not provided — left `null` unless caller supplies station coords)* | `Latitude`/`Longitude` | `aws_data` is the only endpoint of the three that includes real coordinates |
| `state` / `district` | *(not provided)* | `STATE` / `DISTRICT` | |
| `visibility` | *(not provided by either endpoint)* | | always `null` — never estimated |
| `rainfallIntensity` | *(not provided)* | | always `null` — IMD's documented fields don't include an intensity category separate from the mm figure |
| `warningLevel` | *(separate endpoint)* | | comes from `districtwarning`, merged in by the caller, not by `normalizeCurrentWx`/`normalizeAwsData` themselves |

## Refresh / freshness policy

`src/services/freshnessService.js` classifies every reading:

| Age of `observedAt` (falls back to `receivedAt`) | Classification |
|---|---|
| ≤ 90 minutes | `LIVE` |
| ≤ 24 hours | `CACHED` |
| > 24 hours | `STALE` |
| No credentials, no timestamp, or a future timestamp (clock skew) | `UNAVAILABLE` |

These thresholds (90 min / 24 hr) are engineering judgement calls, not an
IMD-published SLA — no freshness/update-frequency guarantee was found in
the public documentation. Adjust `FRESHNESS_WINDOWS_MINUTES` if IMD
publishes one, or once real update cadence is observed.

**Critically: `hasCredentials: false` always forces `UNAVAILABLE`**,
regardless of any cached data's age — the mission explicitly warns
against ever reporting `LIVE` merely because a request once succeeded,
and Phase 2's actual state (no credentials at all) means there has never
been a request to succeed in the first place.

## Cache behavior

No caching layer exists yet because there is nothing to cache — zero live
fetches have ever completed. The `WeatherObservation` collection and its
`(source, sourceRecordId, observedAt)` unique index (partial, only when
`sourceRecordId` is a string) are designed to be idempotent once real
fetches start: re-fetching the same station reading upserts rather than
duplicates. A scheduled poller (respecting IMD's "use client-side caching
to optimize performance during peak weather events" guideline, and the
mission's "do not poll aggressively" instruction) is not yet built — that
belongs in a future phase once credentials exist and real update cadence
can be observed.

## Failure behavior

`weatherService.js` never throws and never fabricates data:

- **No credentials** → returns `{ status: 'UNAVAILABLE', error: 'no_credentials' }` immediately, without attempting a network call.
- **HTTP 401/403** → one attempt only (not retried — an auth failure won't fix itself), returns `UNAVAILABLE` with the HTTP status as the error.
- **HTTP 5xx/429 (transient)** → one retry, then `UNAVAILABLE` if still failing.
- **Network error / timeout (8s)** → one retry, then `UNAVAILABLE`.
- **Malformed response body** (missing required fields, invalid coordinates) → rejected by `weatherValidation.js`, `UNAVAILABLE`, never passed through to the risk engine.

All of this is exercised in `test/weatherService.test.js` using an
injectable `fetchFn` — zero live network calls in the test suite, per the
mission's testing rule.

## Geographic limitations

- No station list or coverage map for the Northeast India region was
  obtained (the `aws_data_mapping` endpoint that would provide this also
  requires authentication). The Guwahati/NER station IDs referenced in
  code comments and test fixtures (e.g. `42314`) are **illustrative
  placeholders based on the documented ID format, not verified real
  station codes** — confirm actual station IDs for the corridor once
  credentials exist, via `GET /api/v1/aws_data_mapping` or
  `GET /api/v1/cityforecast_mapping`.
- Weather-to-road association (`weatherRoadService.js`) uses wider
  confidence radii (HIGH ≤25km, MEDIUM ≤60km, LOW ≤120km) than road
  geometry matching, because weather stations are far sparser than road
  segments — a match is explicitly labeled as "nearest station," never
  implied to be measured on the road itself.

## Attribution

Per IMD's own implementation guideline ("Ensure proper attribution to
IMD"): any UI or report surfacing IMD data must credit "India
Meteorological Department (IMD), Ministry of Earth Sciences" as the
source. The `WeatherObservation.source` field (`IMD_CURRENT_WX` /
`IMD_AWS`) and the dashboard's Data Sources panel already carry this
through; extend the same attribution to any exported report/PPT before
presenting the data externally.

## Access limitations summary

| Item | Status |
|---|---|
| Endpoint documentation | ✅ Obtained (public, no login required) |
| Live API access | ❌ Not obtainable for this project (institutional email required) |
| Auth mechanism (exact header/param) | ⚠️ Unverified — assumed Bearer token, needs correction once real credentials exist |
| Station coverage for NER corridor | ⚠️ Unknown — mapping endpoints also require auth |
| Rate limits | ⚠️ Not documented publicly beyond "use client-side caching" guidance |
| Freshness SLA | ⚠️ Not documented — thresholds here are engineering judgement calls |
