# NER-SMART Backend (Member 3 — Backend + MongoDB)

Node.js + Express + MongoDB API for the NER-SMART disaster-aware logistics prototype.

## Setup

```bash
cd backend
npm install
cp .env.example .env   # then fill in MONGO_URI (local or Atlas)
npm run seed            # populates 5 roads, 5 vehicles, 5 shipments, 5 incidents, 3 warehouses, 3 hospitals
npm run dev              # starts the API on http://localhost:5000
```

## Project structure

```
backend/src/
├── app.js            # Express app, middleware, route mounting
├── server.js          # entry point — loads env, connects DB, starts listening
├── config/db.js       # Mongoose connection
├── models/             # Road, Vehicle, Shipment, Incident, Alert, Warehouse, Hospital
├── controllers/        # one file per resource — thin, delegate to services
├── routes/              # Express routers, mounted under /api/*
├── services/
│   ├── riskService.js     # ONLY place risk is calculated (weighted formula; swap-in point for future ML model)
│   ├── routingService.js  # ONLY place routes are recommended (demo/fallback route catalogue)
│   └── alertService.js    # shared alert-creation helper
├── utils/               # response helpers, async wrapper, error handler
└── seed/seed.js          # demo data seeder
```

All JSON responses follow one shape:

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "message" }
```

## Endpoints & examples

### Shipments

**GET /api/shipments** — list all shipments

**GET /api/shipments/:id** — single shipment

**POST /api/shipments**
```json
// request
{
  "cargo": "Medical Supplies",
  "priority": "CRITICAL",
  "origin": "Guwahati",
  "destination": "Imphal"
}
// response.data
{
  "id": "665f1...",
  "cargo": "Medical Supplies",
  "priority": "CRITICAL",
  "origin": "Guwahati",
  "destination": "Imphal",
  "status": "PENDING",
  "route": { "recommendedRoute": null, "roadName": null, "distance": null, "eta": null, "risk": null, "delay": null, "reason": null }
}
```

### Vehicles

**GET /api/vehicles** — list all vehicles

**POST /api/vehicles/location** — upsert a vehicle's live position
```json
// request (update existing)
{ "vehicleId": "665f2...", "lat": 25.44, "lng": 92.61, "speed": 42 }
// request (create new, no vehicleId)
{ "lat": 25.44, "lng": 92.61, "speed": 0, "status": "IDLE" }
```

### Roads

**GET /api/roads** — list all roads

**PATCH /api/roads/:id**
```json
// request
{ "status": "RESTRICTED", "floodRisk": 60 }
```

### Incidents

**GET /api/incidents**

**POST /api/incidents**
```json
{ "type": "LANDSLIDE", "severity": "HIGH", "lat": 25.5, "lng": 92.8, "description": "Blocked near km 45" }
```

### Alerts

**GET /api/alerts**

**POST /api/alerts**
```json
{ "type": "GENERAL", "severity": "MEDIUM", "message": "Heavy rainfall expected", "shipmentId": "665f1..." }
```

### Risk

**POST /api/risk/predict**
```json
// request
{ "rainfallScore": 55, "slopeScore": 60, "historicalRisk": 50, "roadCondition": 40 }
// response.data
{ "risk": 52.25, "level": "MEDIUM" }
```

### Routes

**POST /api/routes/recommend**
```json
// request
{ "origin": "Guwahati", "destination": "Imphal", "shipmentPriority": "CRITICAL" }
// response.data
{
  "recommendedRoute": "Route B",
  "distance": 430,
  "eta": "10h 20m",
  "risk": 19.25,
  "delay": "35 min",
  "reason": "Lower landslide risk",
  "roadName": "NH-37 Alternate Corridor"
}
```
Automatically excludes any road currently `BLOCKED` in the database.

### Simulation

**POST /api/simulation/landslide**
```json
// request
{ "roadId": "665f0..." }
// response.data
{
  "roadStatus": "BLOCKED",
  "affectedShipments": 2,
  "newRoute": "Route B",
  "alertsCreated": 2
}
```
Flow: blocks the road → bumps its landslideRisk → finds shipments currently routed over it → recalculates each one's route (excluding the blocked road) → saves the new route on each shipment → creates a REROUTE alert per shipment.

### Health check

**GET /api/health** → `{ "success": true, "data": { "status": "ok", "service": "ner-smart-backend" } }`

## Notes for the frontend team

- Every `id` field in responses is a Mongo ObjectId string (models expose `id`, not `_id`, via a toJSON transform).
- `Shipment.route.roadName` is what the simulation matches against to find affected shipments — if you create shipments manually via POST, they'll start with an empty route until `/api/routes/recommend` is called for them.
- CORS is open (`cors()` with defaults) so the Vite dev server can call this API directly.
