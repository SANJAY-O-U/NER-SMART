import React from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import RoadLayer from "./RoadLayer";
import VehicleLayer from "./VehicleLayer";
import IncidentLayer from "./IncidentLayer";
import FacilityLayer from "./FacilityLayer";
import { Polyline } from "react-leaflet";

/**
 * MapView
 * Reusable, dumb map component: it renders whatever data it is given
 * via props. It does NOT fetch data, does NOT talk to MongoDB or any
 * API — the parent dashboard is responsible for fetching
 * roads/vehicles/incidents/facilities and passing them down.
 *
 * Default center/zoom is tuned for the Northeast India demo network
 * (Guwahati - Imphal corridor). Override via `center` / `zoom` if the
 * dashboard needs a different default view.
 *
 * ------------------------------------------------------------------
 * PROPS
 * ------------------------------------------------------------------
 * roads: Array<{
 *   id: string,
 *   name: string,
 *   status: 'OPEN' | 'RISKY' | 'BLOCKED',
 *   lat: number,
 *   lng: number,
 *   floodRisk: number,       // 0-100
 *   landslideRisk: number,   // 0-100
 *   overallRisk?: number     // 0-100, computed if omitted
 * }>
 *
 * vehicles: Array<{
 *   id: string,
 *   shipmentId: string,
 *   lat: number,
 *   lng: number,
 *   speed: number,
 *   status: string           // e.g. 'MOVING' | 'IDLE' | 'DELAYED' | 'STOPPED'
 * }>
 *
 * incidents: Array<{
 *   id: string,
 *   type: string,
 *   severity: string | number,
 *   lat: number,
 *   lng: number,
 *   description: string,
 *   timestamp: string | number
 * }>
 *
 * facilities: Array<{
 *   id: string,
 *   name: string,
 *   type: 'warehouse' | 'hospital',
 *   lat: number,
 *   lng: number,
 *   capacity?: number,
 *   status?: string
 * }>
 *
 * onRoadClick?: (road) => void   // optional, bubbles road clicks to parent
 * center?: [number, number]      // default: Guwahati [26.1445, 91.7362]
 * zoom?: number                  // default: 7
 * heightClassName?: string       // default: "h-[600px]" (Tailwind)
 * ------------------------------------------------------------------
 *
 * Usage:
 *   <MapView
 *     roads={roads}
 *     vehicles={vehicles}
 *     incidents={incidents}
 *     facilities={facilities}
 *     onRoadClick={(road) => setSelectedRoad(road)}
 *   />
 */

const DEFAULT_CENTER = [26.1445, 91.7362]; // Guwahati, Assam
const DEFAULT_ZOOM = 7;

export default function MapView({
  roads = [],
  vehicles = [],
  incidents = [],
  facilities = [],
  onRoadClick,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  heightClassName = "h-[600px]",
  routeGeometry = null, // Phase 4C: optional real route {type:'LineString', coordinates:[[lng,lat],...]}
}) {
  return (
    <div className={`w-full ${heightClassName} rounded-lg overflow-hidden border border-slate-200 relative`}>
      {/* Prototype disclaimer — required per project scope */}
      <div className="absolute z-[1000] top-2 left-1/2 -translate-x-1/2 bg-white/90 text-slate-600 text-xs px-3 py-1 rounded-full border border-slate-200 shadow-sm pointer-events-none">
        Prototype demo data — not official government GIS data
      </div>

      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <RoadLayer roads={roads} onRoadClick={onRoadClick} />
        <VehicleLayer vehicles={vehicles} />
        <IncidentLayer incidents={incidents} />
        <FacilityLayer facilities={facilities} />
        {routeGeometry && routeGeometry.coordinates && (
          <Polyline
            positions={routeGeometry.coordinates.map(([lng, lat]) => [lat, lng])}
            pathOptions={{ color: "#7c3aed", weight: 5, opacity: 0.9, dashArray: "1 8" }}
          />
        )}
      </MapContainer>
    </div>
  );
}
