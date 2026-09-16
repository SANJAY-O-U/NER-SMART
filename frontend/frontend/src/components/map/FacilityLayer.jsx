import React, { useMemo } from "react";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";
import MapPopup from "./MapPopup";

/**
 * FacilityLayer
 * Renders warehouses and hospitals.
 *
 * NOTE: A `Facility` entity is not part of the shared API contract yet.
 * Until backend/database ownership defines one, this layer expects:
 *
 * Props:
 *   facilities: Array<{
 *     id, name, type ('warehouse' | 'hospital'),
 *     lat, lng, capacity?, status?
 *   }>
 */

const FACILITY_STYLE = {
  warehouse: { color: "#7c3aed", symbol: "W" }, // violet-600
  hospital: { color: "#e11d48", symbol: "H" }, // rose-600
};

function facilityIcon(type) {
  const style = FACILITY_STYLE[type] || { color: "#334155", symbol: "?" };
  const html = `
    <div style="
      width:22px;height:22px;border-radius:6px;
      background:${style.color};border:2px solid white;
      display:flex;align-items:center;justify-content:center;
      color:white;font-size:11px;font-weight:700;
      box-shadow:0 1px 3px rgba(0,0,0,0.4);
    ">${style.symbol}</div>`;
  return L.divIcon({
    html,
    className: "ner-facility-icon",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export default function FacilityLayer({ facilities = [] }) {
  const icons = useMemo(() => {
    const cache = {};
    return (type) => {
      if (!cache[type]) cache[type] = facilityIcon(type);
      return cache[type];
    };
  }, []);

  return (
    <>
      {facilities.map((facility) => (
        <Marker
          key={facility.id}
          position={[facility.lat, facility.lng]}
          icon={icons(facility.type)}
        >
          <Popup>
            <MapPopup type="facility" data={facility} />
          </Popup>
        </Marker>
      ))}
    </>
  );
}
