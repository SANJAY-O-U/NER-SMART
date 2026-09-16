# DEMO_RUN.md — Running the SIH26002 Golden Demo

## 1. MongoDB

MongoDB is already connected via Atlas — connection string lives in
`backend/.env` (`MONGO_URI`). No local MongoDB install needed; just make
sure the machine running the backend has internet access to reach Atlas.

## 2. Start the backend

```bash
cd backend
npm install
npm run seed     # loads the known demo dataset (roads, shipments, incidents, etc.)
npm run dev      # or: npm start
```
Runs on `http://localhost:5000`. Health check: `GET http://localhost:5000/api/health`.

### Import the real road network (required for GPS/NER-DEMO road matching)

`npm run seed` only loads the 5 prototype point-only roads (no real
geometry). `GET /api/roads/nearest` — used by both LIVE GPS and NER DEMO
road matching in the Flutter app — only matches against roads that have
real `geometry`, by design (see `ROUTING_ARCHITECTURE.md`). **Without this
step, every location, including the city-named NER DEMO options, will
show "No nearby road matched."**

```bash
npm run import:roads -- data/sources/nh_guwahati_imphal_corridor.geojson \
  --corridor="Guwahati-Imphal" \
  --source="datta07/INDIAN-SHAPEFILES (MIT)"
npm run backfill:districts   # optional, needed for SACHET district-level alert association
```

The Flutter app's **"NH27 Verified Test Corridor"** NER DEMO option is
guaranteed to match once this import has run — it's an exact real road
endpoint from the imported dataset, not an approximation.

## 3. Start the frontend (government dashboard)

```bash
cd frontend
npm install
npm run dev
```
Runs on the Vite dev server (default `http://localhost:5173`). Confirm
`.env` → `VITE_API_BASE_URL=http://localhost:5000/api` points at the
backend above.

## 4. Start the Flutter driver app

See `FLUTTER_SETUP.md` for one-time native project setup, then:
```bash
cd flutter_app
flutter run
```
Confirm `lib/services/api_service.dart`'s `baseUrl` is reachable from the
device/emulator (10.0.2.2 for Android emulator, LAN IP for a physical
device — see FLUTTER_SETUP.md table).

## 5. Reset demo data (run before every recording)

```bash
curl -X POST http://localhost:5000/api/demo/reset
```
Wipes and re-seeds all collections (roads, shipments, vehicles, incidents,
warehouses, hospitals) to the known starting state — no manual MongoDB
editing needed between takes.

## 6. Golden demo sequence

1. Open the React dashboard — confirm seeded roads/shipments/incidents are visible on the map and in the panels.
2. On the Flutter app: **Home → Report Incident**.
3. Pick a category (e.g. Road Damage), add a description (e.g. "Severe road damage, collapsed section"), confirm location (live GPS or demo fallback), **Submit Report**.
4. App shows: *Report submitted → AI analysing → Incident detected*, then the **Result** screen with incident ID, AI classification, severity, confidence, associated road, and status.
5. On the dashboard: within ~6 seconds (polling interval) the new incident appears in the **Incident Reports** panel and as a marker on the **Live Network Map**, showing the same AI classification/severity/confidence.
6. Officer clicks through the status workflow on that incident: **Verify → Mark Action Required → Resolve**. Each click PATCHes the backend and the dashboard updates.
7. (Secondary) Trigger **SIMULATE LANDSLIDE** on a road in the Road Risk panel — confirm the existing landslide/reroute/alert simulation still works unchanged.

## 7. Expected API/data flow

```
Flutter app
  → POST /api/incidents  { type, lat, lng, description, source: DRIVER_APP }
  → Express incidentController
      → Incident.create()                         (status: REPORTED)
      → aiService.analyzeIncident()                (classification, severity, confidence, summary)
      → geoService.findNearestRoad()               (associates roadId/roadName)
      → incident.save()                            (status: AI_ANALYSED, aiResult attached)
      → riskService.calculateRisk() if severity=HIGH (riskImpact, not persisted)
  → MongoDB (Incident collection)
  → React dashboard: GET /api/incidents (polled every 6s)
      → IncidentPanel (list + AI result) + MapView → IncidentLayer (marker)
  → Officer action: PATCH /api/incidents/:id { status }
  → MongoDB updated → dashboard reflects new status on next poll
```

Demo/fallback vs real, per the mission's technical-honesty requirement:
- **REAL**: MongoDB, Express APIs, React dashboard, Leaflet map, existing risk/routing services, Flutter↔backend integration.
- **DEMO/FALLBACK**: AI analysis defaults to a deterministic local classifier (`aiService.js`) unless `ANTHROPIC_API_KEY` is set in `backend/.env`, in which case it calls the real API and falls back automatically on any failure. GPS location falls back to a fixed demo coordinate if unavailable.
- **FUTURE**: live government GIS integration, production infrastructure, nationwide deployment.
