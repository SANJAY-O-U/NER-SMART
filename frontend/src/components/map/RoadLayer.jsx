import React from "react";
import { CircleMarker, Polyline, Popup, Tooltip } from "react-leaflet";
import MapPopup from "./MapPopup";
import { roadStatusDisplay } from "../../theme/status";

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
 * neutral gray and dashed, not green. The legacy `status` field (used by the
 * landslide simulation) still drives color for prototype roads exactly
 * as before.
 *
 * Colors come from theme/status.js (the app's semantic palette). Status is
 * also conveyed without color: stroke weight, a dashed line for UNKNOWN,
 * and a hover tooltip carrying the status glyph + label.
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
 *   selectedRoadId?: string   // highlights the road currently selected in Road Intelligence
 */

const WEIGHT = { BLOCKED: 5, HIGH_RISK: 4 };

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

export default function RoadLayer({ roads = [], onRoadClick, selectedRoadId }) {
  // The selected road is drawn last so it sits above its neighbours.
  const ordered = selectedRoadId
    ? [...roads.filter((r) => r.id !== selectedRoadId), ...roads.filter((r) => r.id === selectedRoadId)]
    : roads;

  return (
    <>
      {ordered.map((road) => {
        // Real imported roads use physicalStatus (defaults UNKNOWN);
        // legacy demo roads use the original `status` field.
        const displayStatus = road.physicalStatus && road.physicalStatus !== "UNKNOWN"
          ? road.physicalStatus
          : road.status || "UNKNOWN";
        const statusInfo = roadStatusDisplay(displayStatus);
        const color = statusInfo.hex;
        const enrichedRoad = { ...road, overallRisk: computeOverallRisk(road) };
        const isBlocked = displayStatus === "BLOCKED";
        const isUnknown = statusInfo.label === "UNKNOWN";
        const isSelected = road.id === selectedRoadId;
        const baseWeight = WEIGHT[displayStatus] || 3;

        const tooltip = (
          <Tooltip sticky direction="top">
            <strong>{road.name || "Unnamed Road"}</strong> · {statusInfo.glyph} {statusInfo.label}
            {isSelected ? " · selected" : ""}
          </Tooltip>
        );

        const paths = geometryToPaths(road.geometry);

        if (paths.length > 0) {
          return (
            <React.Fragment key={road.id}>
              {/* Selection halo: a wide translucent blue stroke under the road, non-interactive. */}
              {isSelected &&
                paths.map((path, i) => (
                  <Polyline
                    key={`${road.id}-halo-${i}`}
                    positions={path}
                    interactive={false}
                    pathOptions={{ color: "#1d4ed8", weight: baseWeight + 8, opacity: 0.35 }}
                  />
                ))}
              {paths.map((path, i) => (
                <Polyline
                  key={`${road.id}-${i}`}
                  positions={path}
                  pathOptions={{
                    color,
                    weight: isSelected ? baseWeight + 2 : baseWeight,
                    opacity: isSelected ? 1 : 0.85,
                    dashArray: isUnknown ? "6 4" : undefined,
                  }}
                  eventHandlers={{
                    click: () => onRoadClick && onRoadClick(road),
                  }}
                >
                  {tooltip}
                  <Popup>
                    <MapPopup type="road" data={enrichedRoad} linkToIntelligence={Boolean(onRoadClick)} />
                  </Popup>
                </Polyline>
              ))}
            </React.Fragment>
          );
        }

        // Fallback: prototype roads with only a lat/lng point.
        if (road.lat === undefined || road.lng === undefined) return null;
        return (
          <React.Fragment key={road.id}>
            {isSelected && (
              <CircleMarker
                center={[road.lat, road.lng]}
                radius={(isBlocked ? 9 : 7) + 6}
                interactive={false}
                pathOptions={{ color: "#1d4ed8", fillColor: "#1d4ed8", fillOpacity: 0.2, weight: 2, opacity: 0.6 }}
              />
            )}
            <CircleMarker
              center={[road.lat, road.lng]}
              radius={isBlocked ? 9 : 7}
              pathOptions={{
                color: isSelected ? "#0f172a" : color,
                fillColor: color,
                fillOpacity: 0.85,
                weight: isSelected ? 4 : isBlocked ? 3 : 2,
                dashArray: isUnknown ? "3 3" : undefined,
              }}
              eventHandlers={{
                click: () => onRoadClick && onRoadClick(road),
              }}
            >
              {tooltip}
              <Popup>
                <MapPopup type="road" data={enrichedRoad} linkToIntelligence={Boolean(onRoadClick)} />
              </Popup>
            </CircleMarker>
          </React.Fragment>
        );
      })}
    </>
  );
}
