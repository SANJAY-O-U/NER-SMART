# WEATHER_PROVIDER.md — Active Weather Provider

## Current active provider

**WeatherAPI.com** — a third-party weather aggregator, **not an official
government source**. Never described in this app's UI or reports as
"official government weather data."

## Future provider

**IMD** (India Meteorological Department) remains fully implemented and
wired (see `IMD_INTEGRATION.md`) but stays inactive: `IMD_ACCESS =
NOT_VERIFIED` because self-service credential registration is gated to
official `.gov.in`/`.nic.in`/`.cdot.in`/`.cdac.in`/`.nhai.org`/`.icar.org.in`
email domains, which this project does not have. Set `WEATHER_PROVIDER=imd`
plus real `IMD_API_KEY`/`IMD_STATION_IDS` to reactivate it the moment
credentials exist — no code changes required.

## Why a provider switch, not a rewrite

The existing pipeline is unchanged:

```
Weather Provider -> WeatherObservation -> weatherRoadService ->
weatherRiskAdapter -> accessibilityEvidence -> accessibilityEngine ->
route/risk intelligence
```

Only the "Weather Provider" box gained a second implementation
(`src/services/weatherApiService.js` + `weatherApiValidation.js`,
parallel to `weatherService.js` + `weatherValidation.js` for IMD). Every
stage after normalization — the `WeatherObservation` schema,
`weatherRoadService`'s geospatial matching, `weatherRiskAdapter`'s
rainfall/wind scoring, `accessibilityEvidence`/`accessibilityEngine` — is
untouched and provider-agnostic.

`src/controllers/weatherController.js`'s `getActiveProvider()` reads the
`WEATHER_PROVIDER` env var (default `weatherapi`) and is the **one place**
that decides which provider's ingestion (`runConfiguredWeatherIngestion`)
and read-path credential check run.

## Environment variables

```
WEATHER_PROVIDER=weatherapi        # 'weatherapi' (default) or 'imd'
WEATHERAPI_BASE_URL=https://api.weatherapi.com/v1
WEATHERAPI_API_KEY=                # backend/.env only — see below
WEATHER_POLL_INTERVAL_MINUTES=15   # 0 disables automatic polling
```

The IMD variables (`IMD_API_KEY`, `IMD_STATION_IDS`,
`IMD_WEATHER_POLL_INTERVAL_MINUTES`, ...) are documented in
`IMD_INTEGRATION.md` and only take effect when `WEATHER_PROVIDER=imd`.

**The API key never leaves the backend.** It is read only from
`backend/.env`, used only to build the outgoing WeatherAPI request URL,
and is never logged, never included in an API response, and never sent
to the React dashboard or the Flutter app.

## Request shape

`GET {WEATHERAPI_BASE_URL}/current.json?key={key}&q={lat},{lng}` —
coordinate-based (WeatherAPI has no station-ID concept, unlike IMD).

## Where the coordinates come from

WeatherAPI is coordinate-based, so ingestion needs a set of points to
poll. `weatherController.getWeatherPollingLocations()` derives them from
the `Road` collection's own `lat`/`lng` (each road's representative
midpoint) — never an invented coordinate, and never a user's live GPS
fix substituted for a road's own location. Coordinates are rounded to 1
decimal place (~11km) so closely-spaced road segments share one poll
instead of each segment triggering its own API call; that's well within
`weatherRoadService`'s own HIGH-confidence radius (25km), so it doesn't
change which reading a road is matched to at read time. On-demand reads
(`GET /api/weather/road/:roadId`) are unaffected — they still just query
the nearest already-persisted `WeatherObservation`.

## Fields mapped from `current.json`

Only fields WeatherAPI actually documents are mapped — nothing is
invented for fields it doesn't provide, same discipline as
`weatherValidation.js` (IMD):

| Our field | From WeatherAPI | Notes |
|---|---|---|
| `temperatureC` | `current.temp_c` | °C |
| `humidityPct` | `current.humidity` | % |
| `rainfallMm` | `current.precip_mm` | **Caveat:** WeatherAPI documents this as current/recent precipitation, not IMD's specific "last 24hr" window. Fed into the existing `weatherRiskAdapter`'s rainfall-to-score mapping unchanged, per the "reuse, don't invent new scoring rules" instruction — treat the resulting score as approximate, not a 24hr-equivalent figure. |
| `windSpeedKmph` | `current.wind_kph` | km/h |
| `windDirectionDeg` | `current.wind_degree` | degrees |
| `weatherCondition` | `current.condition.text` | human-readable, used as-is |
| `observedAt` | `current.last_updated_epoch` | epoch seconds — timezone-safe, unlike IMD's local-time strings |
| `location` | `location.lat`/`location.lon` (falls back to the requested coordinates if absent) | |
| `visibility` | *(never mapped)* | out of scope for this app even though WeatherAPI provides `vis_km` — not part of the existing risk/accessibility pipeline's inputs |
| `rainfallIntensity` | *(never mapped)* | WeatherAPI has no qualitative rainfall category, same as IMD |
| `warningLevel` | *(never mapped)* | `current.json` carries no warnings; WeatherAPI's separate `alerts.json` is not integrated |
| `state` / `district` | *(never mapped)* | WeatherAPI does not provide Indian LGD-style district data |

## Data source registry

Registered under a **separate key**, `WEATHERAPI_WEATHER` — distinct from
`IMD_WEATHER`, so the dashboard's Data Sources panel never conflates a
third-party fetch with a (currently inactive) government one. Both keys
are always visible; `IMD_WEATHER` stays `UNAVAILABLE`/`CACHED` (never
fabricated as verified) exactly as before this change. Neither key ever
reports `LIVE` merely because an API key is configured — only after a
real fetch actually succeeds.

## Failure behavior

Identical discipline to IMD's integration (`weatherApiService.js`):

- **No credentials** → `UNAVAILABLE` immediately, no network call.
- **HTTP 401/403** → not retried, `UNAVAILABLE` with the HTTP status as the error.
- **HTTP 5xx/429** → one retry, then `UNAVAILABLE` if still failing.
- **Network error / timeout (8s)** → one retry, then `UNAVAILABLE`.
- **Malformed response** → rejected by `weatherApiValidation.js`, `UNAVAILABLE`, never passed to the risk engine.

`src/services/freshnessService.js`'s LIVE/CACHED/STALE/UNAVAILABLE
classification is unchanged — a failed fetch falls back to the latest
valid cached `WeatherObservation` if it's within the freshness window,
otherwise `UNAVAILABLE`. Weather evidence (`accessibilityEvidence.js`)
can raise risk but — enforced by existing, unmodified tests — can never
by itself produce `BLOCKED` or `RESTRICTED`.

## Tests

`test/weatherApiValidation.test.js`, `test/weatherApiIngestion.test.js`,
`test/weatherApiAccessibility.test.js` — fixtures only, zero live network
calls, same rule as the rest of the suite.
