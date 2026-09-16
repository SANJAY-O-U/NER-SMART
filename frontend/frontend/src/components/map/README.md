# Map Module — Member 2 (Interactive Map)

Ownership: `frontend/src/components/map/`

## Files

- `MapView.jsx` — top-level, reusable, dumb map component (entry point).
- `RoadLayer.jsx` — road points, colored by status.
- `VehicleLayer.jsx` — vehicle markers.
- `IncidentLayer.jsx` — incident markers, colored by severity.
- `FacilityLayer.jsx` — warehouses & hospitals.
- `MapPopup.jsx` — shared popup content renderer used by all layers.

## Install (in `frontend/`)

```bash
npm install leaflet react-leaflet
```

`MapView.jsx` already imports `leaflet/dist/leaflet.css`, so no extra CSS wiring is needed.

## `<MapView />` props

| Prop | Type | Required | Notes |
|---|---|---|---|
| `roads` | `Road[]` | no (default `[]`) | see shape below |
| `vehicles` | `Vehicle[]` | no (default `[]`) | see shape below |
| `incidents` | `Incident[]` | no (default `[]`) | see shape below |
| `facilities` | `Facility[]` | no (default `[]`) | see shape below |
| `onRoadClick` | `(road) => void` | no | fired when a road marker is clicked |
| `center` | `[lat, lng]` | no | default `[26.1445, 91.7362]` (Guwahati) |
| `zoom` | `number` | no | default `7` |
| `heightClassName` | `string` | no | Tailwind height class, default `"h-[600px]"` |

### Data shapes

```ts
Road {
  id: string
  name: string
  status: 'OPEN' | 'RISKY' | 'BLOCKED'
  lat: number
  lng: number
  floodRisk: number       // 0-100
  landslideRisk: number   // 0-100
  overallRisk?: number    // 0-100, computed as avg(flood, landslide) if omitted
}

Vehicle {
  id: string
  shipmentId: string
  lat: number
  lng: number
  speed: number
  status: string          // 'MOVING' | 'IDLE' | 'DELAYED' | 'STOPPED'
}

Incident {
  id: string
  type: string
  severity: string | number   // 'LOW'|'MEDIUM'|'HIGH'|'CRITICAL' or 0-100
  lat: number
  lng: number
  description: string
  timestamp: string | number
}

Facility {                 // not yet in shared DB schema — proposed shape
  id: string
  name: string
  type: 'warehouse' | 'hospital'
  lat: number
  lng: number
  capacity?: number
  status?: string
}
```

## Usage

```jsx
import MapView from "./components/map/MapView";

<MapView
  roads={roads}
  vehicles={vehicles}
  incidents={incidents}
  facilities={facilities}
  onRoadClick={(road) => setSelectedRoad(road)}
/>
```

The dashboard owns data fetching (from `/api/roads`, `/api/vehicles`,
`/api/incidents`, and wherever facilities end up living). `MapView` never
calls the API or MongoDB directly — it only renders whatever is passed in.

## Sample demo data (for local testing before backend is ready)

```js
export const sampleRoads = [
  { id: "R1", name: "NH-27 Guwahati–Nagaon", status: "OPEN", lat: 26.2, lng: 92.1, floodRisk: 20, landslideRisk: 10 },
  { id: "R2", name: "NH-2 Imphal Bypass", status: "RISKY", lat: 24.8, lng: 93.9, floodRisk: 45, landslideRisk: 55 },
  { id: "R3", name: "Dima Hasao Hill Pass", status: "BLOCKED", lat: 25.3, lng: 93.0, floodRisk: 30, landslideRisk: 85 },
];

export const sampleVehicles = [
  { id: "V1", shipmentId: "S1", lat: 26.0, lng: 91.9, speed: 42, status: "MOVING" },
  { id: "V2", shipmentId: "S2", lat: 25.1, lng: 93.5, speed: 0, status: "STOPPED" },
];

export const sampleIncidents = [
  { id: "I1", type: "Landslide", severity: "HIGH", lat: 25.3, lng: 93.0, description: "Debris blocking single carriageway", timestamp: Date.now() },
];

export const sampleFacilities = [
  { id: "F1", name: "Guwahati Central Warehouse", type: "warehouse", lat: 26.14, lng: 91.73, capacity: 500 },
  { id: "F2", name: "Imphal District Hospital", type: "hospital", lat: 24.81, lng: 93.94 },
];
```
