/**
 * ⚠️ TEMPORARY PLACEHOLDER — owned by Member 2 (Map/GIS developer).
 *
 * This file exists only so the dashboard is runnable for local testing
 * before the real MapView (Leaflet/MapLibre + OpenStreetMap) lands.
 * DELETE this file and let Member 2 add the real implementation at the
 * same path: frontend/src/components/map/MapView.jsx
 *
 * Expected real props (already wired from Dashboard.jsx): roads, vehicles, shipments.
 */
export default function MapView({ roads = [], vehicles = [], shipments = [] }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-slate-100 text-slate-500 text-sm gap-1">
      <p className="font-semibold">Map placeholder</p>
      <p className="text-xs">
        {roads.length} roads · {vehicles.length} vehicles · {shipments.length} shipments
      </p>
      <p className="text-xs italic">Real map supplied by Member 2</p>
    </div>
  );
}
