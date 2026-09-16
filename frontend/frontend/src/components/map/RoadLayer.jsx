import React from "react";
import { CircleMarker, Polyline, Popup } from "react-leaflet";
import MapPopup from "./MapPopup";

/**
 * RoadLayer
 * Renders each road as either:
 *   - a real polyline, if the road has GeoJSON `geometry` (LineString or
 *     MultiLineString) — this is the case for Phase 1's imported real
 *     road network.
 *   - a color-coded point marker (unchanged from the screening demo), for
 *     prototype roads that only carry a single {lat, lng}.
 *
 * A road is never visually implied to be OPEN/BLOCKED from imported data
 * alone: `physicalStatus` defaults to UNKNOWN for imported roads (the
 * source dataset carries no closure status), and UNKNOWN renders as
 * neutral gray, not green. The legacy `status` field (used by the
 * landslide simulation) still drives color for prototype roads exactly
 * as before.
 *
 * Props:
 *   roads: Array<{
 *     id, name,
 *     status ('OPEN' | 'RESTRICTED' | 'BLOCKED'),         // legacy/demo field
 *     physicalStatus ('OPEN'|'RESTRICTED'|'HIGH_RISK'|'BLOCKED'|'UNKNOWN'), // Phase 1 real-data field
 *     lat, lng, floodRisk, landslideRisk, overallRisk?,
 *     geometry?: { type: 'LineString'|'MultiLineString', coordinates: [...] }
 *   }>
 *   onRoadClick?: (road) => void
 */

const STATUS_COLOR = {
  OPEN: "#10b981", // emerald-500
  RESTRICTED: "#f59e0b", // amber-500
  HIGH_RISK: "#f97316", // orange-500
  BLOCKED: "#dc2626", // red-600
  RISKY: "#f59e0b",
  UNKNOWN: "#94a3b8", // slate-400 — never implies a status we don't actually know
};

function computeOverallRisk(road) {
  if (road.overallRisk !== undefined) return road.overallRisk;
  if (road.floodRisk === undefined && road.landslideRisk === undefined) return undefined;
  const flood = road.floodRisk || 0;
  const landslide = road.landslideRisk || 0;
  return Math.round((flood + landslide) / 2);
}

/** Converts GeoJSON [lng,lat] pairs to Leaflet's [lat,lng] pairs. */
function toLatLngPath(coordinates) {
  return coordinates.map(([lng, lat]) => [lat, lng]);
}

function geometryToPaths(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [toLatLngPath(geometry.coordinates)];
  if (geometry.type === "MultiLineString") return geometry.coordinates.map(toLatLngPath);
  return [];
}

export default function RoadLayer({ roads = [], onRoadClick }) {
  return (
    <>
      {roads.map((road) => {
        // Real imported roads use physicalStatus (defaults UNKNOWN);
        // legacy demo roads use the original `status` field.
        const displayStatus = road.physicalStatus && road.physicalStatus !== "UNKNOWN"
          ? road.physicalStatus
          : road.status || "UNKNOWN";
        const color = STATUS_COLOR[displayStatus] || STATUS_COLOR.UNKNOWN;
        const enrichedRoad = { ...road, overallRisk: computeOverallRisk(road) };
        const isBlocked = displayStatus === "BLOCKED";

        const paths = geometryToPaths(road.geometry);

        if (paths.length > 0) {
          return (
            <React.Fragment key={road.id}>
              {paths.map((path, i) => (
                <Polyline
                  key={`${road.id}-${i}`}
                  positions={path}
                  pathOptions={{
                    color,
                    weight: isBlocked ? 5 : 3,
                    opacity: 0.85,
                    dashArray: displayStatus === "UNKNOWN" ? "6 4" : undefined,
                  }}
                  eventHandlers={{
                    click: () => onRoadClick && onRoadClick(road),
                  }}
                >
                  <Popup>
                    <MapPopup type="road" data={enrichedRoad} />
                  </Popup>
                </Polyline>
              ))}
            </React.Fragment>
          );
        }

        // Fallback: prototype roads with only a lat/lng point.
        if (road.lat === undefined || road.lng === undefined) return null;
        return (
          <CircleMarker
            key={road.id}
            center={[road.lat, road.lng]}
            radius={isBlocked ? 9 : 7}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: 0.85,
              weight: isBlocked ? 3 : 2,
            }}
            eventHandlers={{
              click: () => onRoadClick && onRoadClick(road),
            }}
          >
            <Popup>
              <MapPopup type="road" data={enrichedRoad} />
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
