import React, { useMemo } from "react";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";
import MapPopup from "./MapPopup";

/**
 * IncidentLayer
 * Renders incident markers (warning-triangle icon, severity-colored).
 *
 * Props:
 *   incidents: Array<{ id, type, severity, lat, lng, description, timestamp }>
 */

const SEVERITY_COLOR = {
  LOW: "#f59e0b", // amber-500
  MEDIUM: "#f97316", // orange-500
  HIGH: "#dc2626", // red-600
  CRITICAL: "#991b1b", // red-800
};

function severityColor(severity) {
  if (typeof severity === "number") {
    if (severity > 75) return SEVERITY_COLOR.CRITICAL;
    if (severity > 50) return SEVERITY_COLOR.HIGH;
    if (severity > 25) return SEVERITY_COLOR.MEDIUM;
    return SEVERITY_COLOR.LOW;
  }
  return SEVERITY_COLOR[severity] || SEVERITY_COLOR.MEDIUM;
}

function incidentIcon(severity) {
  const color = severityColor(severity);
  const html = `
    <div style="
      width:0;height:0;
      border-left:9px solid transparent;
      border-right:9px solid transparent;
      border-bottom:16px solid ${color};
      filter: drop-shadow(0 0 1px rgba(0,0,0,0.4));
    "></div>`;
  return L.divIcon({
    html,
    className: "ner-incident-icon",
    iconSize: [18, 16],
    iconAnchor: [9, 14],
  });
}

export default function IncidentLayer({ incidents = [] }) {
  const icons = useMemo(() => {
    const cache = {};
    return (severity) => {
      const key = String(severity);
      if (!cache[key]) cache[key] = incidentIcon(severity);
      return cache[key];
    };
  }, []);

  return (
    <>
      {incidents.map((incident) => (
        <Marker
          key={incident.id}
          position={[incident.lat, incident.lng]}
          icon={icons(incident.severity)}
        >
          <Popup>
            <MapPopup type="incident" data={incident} />
          </Popup>
        </Marker>
      ))}
    </>
  );
}
