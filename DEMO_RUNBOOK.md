# DEMO_RUNBOOK.md — NER Smart Live Demonstration (3-5 minutes)

## Before you start

```bash
# Terminal 1 - backend
cd backend && npm install && npm run seed && npm run dev

# Terminal 2 - frontend
cd frontend && npm install && npm run dev

# One-time, before recording: reset to a known state
curl -X POST http://localhost:5000/api/demo/reset   # requires APP_MODE=demo in backend/.env
```

**Do NOT use Guwahati<->Imphal for the routing step** — that pair is confirmed `NO_CONNECTED_ROUTE` (see `ROUTING_ARCHITECTURE.md`, Phase 4C.1). Use the verified corridor coordinates below instead.

**Verified test corridor** (real, connected NH 27 stretch): origin `(24.8390, 92.8332)`, destination `(26.3136, 92.7089)`.

---

## 0:00 - Introduce NER Smart

Say: *"NER Smart is a road accessibility and logistics intelligence platform for Northeast India — not a navigation app. It answers one question: can this shipment safely reach its destination, and by which route, given current real evidence?"*

Show: the dashboard home screen (`http://localhost:5173`).

## 0:30 - Show NER road intelligence

Point at: the **Live Network Map** card. Zoom into the road polylines.

Say: *"These are 260 real road segments — NH 27, NH 29, NH 2 — imported from a real, licensed geospatial dataset, not drawn by hand."* (See `DATA_PROVENANCE.md` for the exact source.)

## 1:00 - Show current accessibility

Click a road on the map (one within the verified corridor, e.g. near 25.5°N, 93.0°E).

Show: the **Road Risk** card populates with the road's name and current risk figures.

Say: *"This score comes from a deterministic accessibility engine that fuses road status, disaster alerts, and field reports — not a black box."*

## 1:30 - Submit a REAL field observation

**Option A (Flutter, if a device/emulator is set up):** Open the app -> Report Incident -> set Location Mode to **NER DEMO** -> pick a location near the test corridor -> category **Landslide** -> **Capture Report**. Show the "Report Captured" / sync-status screen.

**Option B (curl, reliable fallback if no device is available):**
```bash
curl -X POST http://localhost:5000/api/incidents \
  -H "Content-Type: application/json" \
  -d '{"type":"LANDSLIDE","severity":"HIGH","lat":25.5,"lng":93.0,"description":"Landslide blocking one lane","source":"DRIVER_APP","locationMode":"NER_DEMO"}'
```

Say: *"This is a real API call, not a scripted animation — the response you're about to see is computed live."*

## 2:00 - Show incident->road association

In the terminal/Postman response (or the dashboard's **Incident Reports** panel), point at `roadName`, `roadMatchConfidence`, `associationMethod`.

Say: *"The report was matched to the nearest real road using a MongoDB 2dsphere geospatial query — the confidence you see reflects both GPS accuracy and distance."*

## 2:20 - Show accessibility impact

Point at `accessibilityImpact.before` vs `accessibilityImpact.after` in the same response (or click **View Impact** on the incident in the dashboard).

Say: *"The road's accessibility score just dropped — from [before.accessibilityScore] to [after.accessibilityScore] — and its state changed from [before.state] to [after.state]. This is computed evidence, not a hardcoded demo number."*

## 2:40 - Request a route recommendation

In the dashboard's **Route Recommendation** card, switch to **Real Road Network** mode, enter the corridor coordinates above, pick a cargo priority (e.g. EMERGENCY), click **COMPUTE REAL ROUTE**.

Say: *"Watch the Safest Feasible route avoid the segment we just reported, while the Shortest Feasible route still goes through it — same real road graph, different risk tolerance."*

## 3:00 - Show the operational alert

In the dashboard, refresh the incident's **View Impact** panel — the generated alert (`RISK_WARNING`, with its `triggerReason`) should be visible.

Say: *"This alert was generated automatically because the accessibility state crossed a documented threshold — not because we told the system to fire one."*

## 3:20 - Resolve the incident

```bash
curl -X PATCH http://localhost:5000/api/incidents/<incidentId> \
  -H "Content-Type: application/json" -d '{"status":"RESOLVED"}'
```

## 3:40 - Show recovery

Point at the new `accessibilityImpact` in the response — score and state should recover toward the pre-incident baseline (since the resolved incident's evidence is now excluded).

Say: *"The loop closes: field report -> road impact -> route change -> alert -> resolution -> recovery, all through real APIs."*

## 4:00 - Explain the offline field workflow

Say: *"If a driver has no signal, the report is written to the device's local SQLite database first — that's what 'captured' means in this app, before any network call. It syncs automatically once connectivity returns, using an idempotency key so a retried upload never creates a duplicate incident."* (Point at `OFFLINE_ARCHITECTURE.md` if asked for detail — no need to demo this live unless you have a device and can toggle Airplane Mode.)

## 4:30 - State current limitations honestly

Say plainly:
- *"Guwahati<->Imphal specifically isn't routable yet — the imported dataset has a real ~50km digitization gap near Nagaon that we traced and documented rather than faking a connection."*
- *"IMD live weather access is not verified — we built the full integration architecture, but couldn't obtain credentials, so the system honestly reports weather as unavailable rather than fabricating it."*
- *"NDMA SACHET disaster alerts ARE live and verified — that's a real government feed."*
- *"There's no authentication yet — this is a prototype, and every API call in this demo is unauthenticated by design at this stage."*

---

## What NOT to do during the demo

- Don't claim "AI" for the fallback classifier — it's a deterministic keyword heuristic unless `ANTHROPIC_API_KEY` is configured (the dashboard now labels this "Classification (heuristic)" when that's the case).
- Don't attempt the Guwahati<->Imphal route live — it will correctly return `NO_CONNECTED_ROUTE`, which is fine to show ONCE as a demonstration of honesty, but don't present it as a working end-to-end route.
- Don't claim GPS accuracy or offline sync was "tested on a real device" unless you actually have one running during this specific demo session.
