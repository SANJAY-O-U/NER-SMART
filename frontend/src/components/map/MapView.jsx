import React, { useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import RoadLayer from "./RoadLayer";
import VehicleLayer from "./VehicleLayer";
import IncidentLayer from "./IncidentLayer";
import FacilityLayer from "./FacilityLayer";
import { Polyline } from "react-leaflet";
import MapLegend from "./MapLegend";

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
 * selectedRoadId?: string        // optional, highlights that road (parent owns the selection)
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
  selectedRoadId,
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  heightClassName = "h-[600px]",
  routeGeometry = null, // Phase 4C: optional real route {type:'LineString', coordinates:[[lng,lat],...]}
  bare = false, // presentation only: drop the frame when the parent panel already provides one
}) {
  // Presentation-only layer visibility; every layer starts visible, as before.
  const [hidden, setHidden] = useState({});
  const toggleLayer = (key) => setHidden((h) => ({ ...h, [key]: !h[key] }));
  const show = (key) => !hidden[key];

  const hasRoute = Boolean(routeGeometry && routeGeometry.coordinates);
  // A toggle is offered only for a layer that has something to show.
  const layers = [
    { key: "roads", label: "Roads", count: roads.length },
    { key: "vehicles", label: "Vehicles", count: vehicles.length },
    { key: "incidents", label: "Incidents", count: incidents.length },
    { key: "facilities", label: "Facilities", count: facilities.length },
    { key: "route", label: "Route line", count: hasRoute ? 1 : 0 },
  ]
    .filter((l) => l.count > 0)
    .map((l) => ({ ...l, visible: show(l.key) }));

  return (
    // `isolate` gives the map its own stacking context so Leaflet's high z-index panes and
    // controls can never paint over the sticky header.
    <div
      role="region"
      aria-label="Map of roads, incidents and vehicles"
      className={`w-full ${heightClassName} overflow-hidden relative isolate ${bare ? "" : "rounded-lg border border-slate-200"}`}
    >
      {/* Keyboard alternative to the map: road lines cannot take keyboard focus, so this jumps to the
          Road Intelligence road selector, which selects a road through the same state as a map click. */}
      <a
        href="#road-select"
        className="sr-only focus:not-sr-only absolute z-[1100] top-2 left-2 rounded-md border border-primary-600 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 shadow-raised"
      >
        Skip map: choose a road in Road Intelligence
      </a>
      {/* Prototype disclaimer — required per project scope. Wraps on narrow screens and keeps clear of
          the zoom control (left) instead of overlapping it. */}
      <div className="absolute z-[1000] top-2 left-12 right-2 sm:right-12 mx-auto w-fit max-w-[calc(100%-3.5rem)] sm:max-w-[calc(100%-6rem)] bg-white/90 text-slate-600 text-xs leading-snug text-center px-3 py-1 rounded-2xl border border-slate-200 shadow-sm pointer-events-none">
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

        {show("roads") && <RoadLayer roads={roads} onRoadClick={onRoadClick} selectedRoadId={selectedRoadId} />}
        {show("vehicles") && <VehicleLayer vehicles={vehicles} />}
        {show("incidents") && <IncidentLayer incidents={incidents} />}
        {show("facilities") && <FacilityLayer facilities={facilities} />}
        {hasRoute && show("route") && (
          <Polyline
            positions={routeGeometry.coordinates.map(([lng, lat]) => [lat, lng])}
            pathOptions={{ color: "#7c3aed", weight: 5, opacity: 0.9, dashArray: "1 8" }}
          />
        )}
      </MapContainer>

      <MapLegend layers={layers} onToggle={toggleLayer} showRoutes={hasRoute && show("route")} />
    </div>
  );
}
