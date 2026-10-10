import React, { useState } from "react";
import { CircleMarker, Pane, Polyline, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import MapPopup from "./MapPopup";
import { roadStatusDisplay, effectiveRoadStatus } from "../../theme/status";
import { CASING_COLOR, UNKNOWN_DASH, roadLineWeight, roadCasingWeight } from "./roadStyle";

/**
 * RoadLayer
 * Renders each road as either:
 *   - a real polyline, if the road has GeoJSON `geometry` (LineString or
 *     MultiLineString) — this is the case for Phase 1's imported real
 *     road network.
 *   - a color-coded point marker (unchanged from the screening demo), for
 *     prototype roads that only carry a single {lat, lng}.
 *
 * The status drawn is the frontend STORED-STATUS display policy in theme/status.js
 * (effectiveRoadStatus): the most restrictive recognised status among the physical, official and field
 * statuses and the legacy/simulated status wins; a road with none is UNKNOWN. UNKNOWN is a neutral gray
 * dashed line, never green, so an unverified road is never presented as open or safe. This is a summary
 * of what is stored on the road, not the backend accessibility engine's verdict.
 *
 * Colors come from theme/status.js. Status is also conveyed without color: stroke weight, a dashed line
 * for UNKNOWN, and a hover tooltip carrying the status glyph + label. Every line sits on a thin white
 * casing (drawn in a pane below all roads, so a neighbour's casing never covers another road) and its
 * weight scales with the map zoom (roadStyle.js).
 *
 * Props:
 *   roads: Array<{
 *     id, name,
 *     status ('OPEN' | 'RESTRICTED' | 'BLOCKED'),         // legacy/demo field
 *     physicalStatus / officialStatus / fieldStatus ('OPEN'|'RESTRICTED'|'HIGH_RISK'|'BLOCKED'|'UNKNOWN'),
 *     lat, lng, floodRisk, landslideRisk, overallRisk?,
 *     geometry?: { type: 'LineString'|'MultiLineString', coordinates: [...] }
 *   }>
 *   onRoadClick?: (road) => void
 *   selectedRoadId?: string   // highlights the road currently selected in Road Intelligence
 */

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

/**
 * Road lines are bare SVG elements that cannot take keyboard focus, so they must not announce themselves
 * as buttons (they used to carry role="button" and a "Press Enter" label that no keyboard user could
 * ever act on). They are hidden from assistive technology; keyboard users select a road with the map's
 * "Road" dropdown or the Road Intelligence selector, which drive the same selection state as a click.
 */
function hideFromAssistiveTech(layer) {
  const el = layer && typeof layer.getElement === "function" ? layer.getElement() : null;
  if (el) {
    el.removeAttribute("role");
    el.removeAttribute("aria-label");
    el.setAttribute("aria-hidden", "true");
  }
}

/** Current map zoom, kept in state so line weights follow zoom changes. */
function useMapZoom() {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  return zoom;
}

export default function RoadLayer({ roads = [], onRoadClick, selectedRoadId }) {
  const zoom = useMapZoom();

  // The selected road is drawn last so it sits above its neighbours.
  const ordered = selectedRoadId
    ? [...roads.filter((r) => r.id !== selectedRoadId), ...roads.filter((r) => r.id === selectedRoadId)]
    : roads;

  // Final line weight for a road at the current zoom (the selected road is drawn 2px heavier).
  const weightFor = (road, status) => roadLineWeight(status, zoom) + (road.id === selectedRoadId ? 2 : 0);

  // White casings, all in one pane below every road line. Non-interactive, so clicks reach the lines.
  const casings = ordered.flatMap((road) => {
    const weight = roadCasingWeight(weightFor(road, effectiveRoadStatus(road)));
    return geometryToPaths(road.geometry).map((path, i) => (
      <Polyline
        key={`${road.id}-casing-${i}`}
        positions={path}
        interactive={false}
        pane="road-casing"
        pathOptions={{ color: CASING_COLOR, weight, opacity: 0.9, lineCap: "round", lineJoin: "round" }}
      />
    ));
  });

  return (
    <>
      <Pane name="road-casing" style={{ zIndex: 399 }}>
        {casings}
      </Pane>

      {ordered.map((road) => {
        // One shared rule (theme/status.js): the most restrictive recognised stored status wins; an
        // imported road's default legacy "OPEN" is ignored; demo roads keep their legacy `status`.
        const displayStatus = effectiveRoadStatus(road);
        const statusInfo = roadStatusDisplay(displayStatus);
        const color = statusInfo.hex;
        const enrichedRoad = { ...road, overallRisk: computeOverallRisk(road) };
        const isBlocked = displayStatus === "BLOCKED";
        const isUnknown = statusInfo.label === "UNKNOWN";
        const isSelected = road.id === selectedRoadId;
        const lineWeight = weightFor(road, displayStatus);

        const tooltip = (
          <Tooltip sticky direction="top">
            <strong>{road.name || "Unnamed Road"}</strong> · {statusInfo.glyph} {statusInfo.label}
            {isSelected ? " · selected" : ""}
          </Tooltip>
        );

        const paths = geometryToPaths(road.geometry);
        const handlers = {
          click: () => onRoadClick && onRoadClick(road),
          add: (e) => hideFromAssistiveTech(e.target),
        };

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
                    pathOptions={{ color: "#1d4ed8", weight: lineWeight + 8, opacity: 0.35 }}
                  />
                ))}
              {paths.map((path, i) => (
                <Polyline
                  key={`${road.id}-${i}`}
                  positions={path}
                  pathOptions={{
                    color,
                    weight: lineWeight,
                    opacity: isSelected ? 1 : 0.9,
                    dashArray: isUnknown ? UNKNOWN_DASH : undefined,
                    lineCap: "butt",
                  }}
                  ref={hideFromAssistiveTech}
                  eventHandlers={handlers}
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
              ref={hideFromAssistiveTech}
              eventHandlers={handlers}
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
