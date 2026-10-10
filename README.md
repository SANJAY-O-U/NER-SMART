# NER-SMART

**Route Intelligence & Resilience Layer for essential logistics in India's North Eastern Region** (SIH 2026).

NER-SMART is a road *accessibility and logistics intelligence* platform, not a navigation app. It answers one question:
**can this shipment still reach its destination, and by which road?** It fuses road status, official disaster alerts,
weather and driver-reported field incidents into a deterministic, explainable accessibility score per road, and uses
that score for risk-aware route recommendations.

## Components

| Component | Folder | Stack | Role |
|---|---|---|---|
| Backend API | [`backend/`](backend/) | Node.js (>=22 <23), Express, MongoDB (Mongoose) | Roads, incidents, accessibility engine, routing, alert/weather ingestion |
| Dashboard | [`frontend/`](frontend/) | React, Vite, Leaflet | Government/operator view: live road map, accessibility, incidents, route recommendation |
| Driver app | [`flutter_app/`](flutter_app/) | Flutter (Dart SDK >=3.0 <4.0) | Field incident capture with GPS, offline store-and-forward sync |

## What it does (and where it is documented)

- **Road network and routing** - 260 real NH 27 / NH 29 / NH 2 road segments (Guwahati-Imphal corridor), a road-graph
  router with accessibility-aware cost, ETA and confidence. See [ROUTING_ARCHITECTURE.md](ROUTING_ARCHITECTURE.md).
- **Accessibility and resilience** - a deterministic accessibility engine combining road status, disaster alerts and field
  reports, with before/after impact per incident. Incident processing is resumable: an interrupted report is completed on
  retry instead of being left half-processed.
- **NDMA SACHET alerts** - live disaster-alert ingestion, no credentials needed. See [SACHET_INTEGRATION.md](SACHET_INTEGRATION.md).
- **Weather** - WeatherAPI.com (third-party, *not* an official government feed) is the active provider; an IMD provider is
  implemented but stays `UNAVAILABLE` without credentials this project does not have. See
  [WEATHER_PROVIDER.md](WEATHER_PROVIDER.md) and [IMD_INTEGRATION.md](IMD_INTEGRATION.md).
- **GPS and field capture** - live GPS and a "NER demo" location mode, matched to the nearest road with a MongoDB `2dsphere`
  query. See [GPS_LOCATION_ARCHITECTURE.md](GPS_LOCATION_ARCHITECTURE.md).
- **Offline field reporting** - the Flutter app stores reports locally and syncs idempotently when connectivity returns.
  See [OFFLINE_ARCHITECTURE.md](OFFLINE_ARCHITECTURE.md).
- **Optional AI incident classification** - Gemini or Anthropic when a key is configured; otherwise (or on any provider
  failure) a deterministic fallback classifier is used and is labelled as such. The server computes incident severity itself.
- **Data sources are honest** - every live feed registers its real status; nothing is presented as live when it is not.
  See [DEMO_EVIDENCE.md](DEMO_EVIDENCE.md) for what can actually be demonstrated.

## Repository layout

```
backend/      Express API: src/ (app, routes, controllers, services, models, middleware, config), test/, scripts/, data/
frontend/     React + Vite dashboard (src/components, src/pages, src/services)
flutter_app/  Flutter driver app (lib/, test/, plus android/ ios/ macos/ windows/ linux/ web/)
*.md          Architecture and integration documents (see list below)
```

## Prerequisites

- Node.js 22.x and npm
- A MongoDB database (MongoDB Atlas or local). **Always name the database in the connection string**
  (for example a separate `ner-smart-dev`); without a name the driver silently uses `test`.
- Flutter SDK (stable) only if you build the driver app
- Optional API keys, all backend-only: WeatherAPI.com, Gemini or Anthropic

## Quick start (local development)

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env        # then edit .env: set MONGO_URI (with a database name) and any optional keys
npm run seed                # WIPES and re-creates demo data; only runs with APP_MODE=demo - point MONGO_URI at a dev database
npm run dev                 # http://localhost:5000  (health: GET /api/health)
```

Import the real road network (needed for GPS / NER-demo road matching and real-road routing):

```bash
npm run import:roads -- data/sources/nh_guwahati_imphal_corridor.geojson \
  --corridor="Guwahati-Imphal" \
  --source="datta07/INDIAN-SHAPEFILES (MIT) — INDIA_NATIONAL_HIGHWAY.geojson"
npm run backfill:districts  # optional: district-level SACHET alert association
```

### 2. Dashboard

```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_BASE_URL=http://localhost:5000/api
npm run dev                 # http://localhost:5173
```

For write actions (incident status, demo reset, simulation) against a **local** backend only, put the backend's
`NER_API_KEY` in `frontend/.env.development.local` as `VITE_API_KEY` (gitignored, read by `vite dev` only).
See [`frontend/.env.example`](frontend/.env.example).

### 3. Driver app (Flutter)

```bash
cd flutter_app
flutter pub get
flutter run                                                        # Android emulator -> http://10.0.2.2:5000/api
flutter run --dart-define=NER_API_BASE_URL=http://<LAN-IP>:5000/api   # physical device, debug builds
```

Release builds require an HTTPS backend and fail closed otherwise:
`flutter build apk --release --dart-define=NER_API_BASE_URL=https://<host>/api`.
The app sends no API key by design. See [FLUTTER_SETUP.md](FLUTTER_SETUP.md) for platform notes (the `flutter create .`
step in that older document is no longer needed, the platform folders are committed).

### 4. Demo

[DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) and [DEMO_RUN.md](DEMO_RUN.md) walk through the demo. Use the **verified NH 27 corridor**
coordinates given there: the Guwahati-Imphal pair currently reports `NO_CONNECTED_ROUTE` (see
[ROUTING_ARCHITECTURE.md](ROUTING_ARCHITECTURE.md)).

## Configuration

All backend configuration is documented, with comments, in [`backend/.env.example`](backend/.env.example). Real values live
only in `backend/.env` / `frontend/.env`, which are gitignored. Never commit them.

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection string; must name the database |
| `APP_MODE` | `demo` enables demo reset/simulation; use `production` (or anything but `demo`) when deployed |
| `NODE_ENV` | `production` hides internal error detail and enforces the startup checks below |
| `NER_API_KEY` | Shared secret (`x-api-key` header) required on write endpoints, except `POST /api/incidents` (the field app's endpoint) |
| `NER_ALLOWED_ORIGINS` | Comma-separated CORS origins (no `*` in production) |
| `NER_RATE_LIMIT_*`, `NER_WRITE_RATE_LIMIT_MAX`, `NER_TRUST_PROXY_HOPS` | Rate limiting and proxy settings |
| `WEATHER_PROVIDER`, `WEATHERAPI_API_KEY`, `WEATHER_POLL_INTERVAL_MINUTES` | Weather provider and polling |
| `IMD_*` | Future IMD provider (disabled by default) |
| `SACHET_POLL_INTERVAL_MINUTES` | SACHET polling (no credentials) |
| `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `ANTHROPIC_API_KEY` | Optional AI classification |
| `VITE_API_BASE_URL` (frontend) | Backend URL; the production build fails if it is unset |
| `NER_API_BASE_URL` (Flutter, `--dart-define`) | Backend URL for the driver app |

With `NODE_ENV=production` the backend refuses to start unless `MONGO_URI`, `NER_API_KEY`, `NER_ALLOWED_ORIGINS`,
`WEATHER_PROVIDER` and that provider's key are set, and (with `APP_MODE=production`) unless `MONGO_URI` names a database
other than `test`. Missing variable names are logged, never their values.

## Tests and builds

```bash
cd backend && npm test            # node --test test/*.test.js; no database or network needed
cd frontend && npm test           # node --test test/*.test.js; dependency-free tests of the road-status policy and map styling
cd frontend && npm run build      # production bundle (fails if VITE_API_BASE_URL is unset or VITE_API_KEY is set)
cd flutter_app && flutter test    # Dart unit and widget tests
```

The frontend tests cover the pure status and styling logic only. There are no component, browser or accessibility test
suites, and nothing in the repository runs any of these tests automatically (there is no CI configuration).

## Road status on the dashboard

The map line, popup badge, Road Intelligence badge, legend and the "Blocked (Stored status)" and "Unverified Roads" KPIs
all use one **stored-status display policy** (`frontend/src/theme/status.js`). It summarises what is *stored* on each
road. It is **not** a replacement for the backend accessibility engine, which also weighs weather, SACHET alerts and
field incidents and is shown separately, per selected road, in Road Intelligence.

- **Evidence:** `physicalStatus`, `officialStatus` and `fieldStatus` (OPEN, RESTRICTED, HIGH_RISK, BLOCKED), plus the
  legacy `status` field. Legacy BLOCKED and RESTRICTED always count (the landslide simulation writes BLOCKED there).
  Legacy OPEN counts only on a demo road (no `source`); on an imported road it is the importer's default and is ignored.
  UNKNOWN, missing and unrecognised values are ignored.
- **Precedence:** the most restrictive recognised value wins: BLOCKED > RESTRICTED > HIGH_RISK > OPEN (the order the
  backend engine uses), so an OPEN never hides a block. When sources disagree the popup lists each one.
- **No evidence means UNKNOWN:** a neutral, dashed gray line. It is never presented as open, safe or accessible, and it is
  counted separately ("Unverified Roads"), never as blocked.

Keyboard: road lines are not tab stops. Use the **Road** dropdown in the map panel header (or the Road Intelligence
selector); both drive the same selection as a map click and neither pans the map. Verified in Chromium only; other
browsers and screen readers have not been tested.

## Deployment notes

The project is set up for a Node host for the backend (Render has been used) and a static host for the dashboard (Vercel
has been used). Deployment settings are environment variables only; no platform configuration file is committed. In
production: set the variables above in the host's secret store, set `NER_TRUST_PROXY_HOPS` when behind a proxy, and keep
`VITE_API_KEY` out of the dashboard build, because every `VITE_*` value is bundled into public JavaScript. Deployed
dashboards are read-only by design.

## Known limitations

- The Guwahati-Imphal road pair is not one connected graph in the current dataset (`NO_CONNECTED_ROUTE`); the verified
  NH 27 stretch is the supported routing demo.
- Road data is a community-compiled dataset, not an official government feed, and its survey date is unknown. See
  [DATA_PROVENANCE.md](DATA_PROVENANCE.md).
- Weather comes from a third-party aggregator; IMD integration is unverified and disabled without credentials.
- SACHET association to roads is district-level, not polygon-level.
- Some older documents ([backend/README.md](backend/README.md), [DEMO_RUN.md](DEMO_RUN.md), [FLUTTER_SETUP.md](FLUTTER_SETUP.md))
  predate later hardening (API-key gate, restricted CORS, build-time Flutter URL). Where they disagree with this README
  or with `.env.example`, trust those.
- A weather-provider body-read stall (a response that sends headers and then stalls) is characterised by
  `backend/test/weatherApiBodyStall.test.js` and is not fixed yet.

## Data provenance and licensing

The road dataset (`backend/data/sources/nh_guwahati_imphal_corridor.geojson`) is a feature subset of
[datta07/INDIAN-SHAPEFILES](https://github.com/datta07/INDIAN-SHAPEFILES) (MIT). Source, verification and attribution:
[DATA_PROVENANCE.md](DATA_PROVENANCE.md), [NOTICE.md](NOTICE.md) and the licence text next to the data file.
`NOTICE.md` covers third-party material only; this repository does not yet declare a licence for NER-SMART's own code.

## Security notes

- Real secrets live only in gitignored `.env` files. `.env.example` files are templates with empty values.
- `NER_API_KEY`, weather keys and AI keys are backend-only; they are never sent to the dashboard or the Flutter app.
- Internal error details are hidden from API responses in production.
- `POST /api/incidents` (the driver app's ingestion endpoint) is deliberately **not** behind the API key, because a key
  shipped inside a mobile app is extractable. It is write-rate-limited and idempotent on `clientEventId`; per-device
  credentials for field ingestion are a documented follow-up, not implemented.
- `POST /api/demo/reset` and `npm run seed` destroy data and only run with `APP_MODE=demo`; never set that against a
  production database.

## Documents

[ROUTING_ARCHITECTURE](ROUTING_ARCHITECTURE.md) · [GPS_LOCATION_ARCHITECTURE](GPS_LOCATION_ARCHITECTURE.md) ·
[OFFLINE_ARCHITECTURE](OFFLINE_ARCHITECTURE.md) · [SACHET_INTEGRATION](SACHET_INTEGRATION.md) ·
[WEATHER_PROVIDER](WEATHER_PROVIDER.md) · [IMD_INTEGRATION](IMD_INTEGRATION.md) · [DATA_PROVENANCE](DATA_PROVENANCE.md) ·
[NOTICE](NOTICE.md) · [DEMO_RUNBOOK](DEMO_RUNBOOK.md) · [DEMO_RUN](DEMO_RUN.md) · [DEMO_EVIDENCE](DEMO_EVIDENCE.md) ·
[FLUTTER_SETUP](FLUTTER_SETUP.md)
