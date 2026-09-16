import React, { useMemo } from "react";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";
import MapPopup from "./MapPopup";

/**
 * VehicleLayer
 * Renders vehicle markers (truck icon, status-colored).
 *
 * Props:
 *   vehicles: Array<{ id, shipmentId, lat, lng, speed, status }>
 */

const STATUS_COLOR = {
  MOVING: "#2563eb", // blue-600
  IDLE: "#64748b", // slate-500
  DELAYED: "#f59e0b", // amber-500
  STOPPED: "#dc2626", // red-600
};

function vehicleIcon(status) {
  const color = STATUS_COLOR[status] || "#2563eb";
  const html = `
    <div style="
      width:16px;height:16px;border-radius:50%;
      background:${color};border:2px solid white;
      box-shadow:0 0 0 1px ${color};
    "></div>`;
  return L.divIcon({
    html,
    className: "ner-vehicle-icon",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export default function VehicleLayer({ vehicles = [] }) {
  const icons = useMemo(() => {
    const cache = {};
    return (status) => {
      if (!cache[status]) cache[status] = vehicleIcon(status);
      return cache[status];
    };
  }, []);

  return (
    <>
      {vehicles.map((vehicle) => (
        <Marker
          key={vehicle.id}
          position={[vehicle.lat, vehicle.lng]}
          icon={icons(vehicle.status)}
        >
          <Popup>
            <MapPopup type="vehicle" data={vehicle} />
          </Popup>
        </Marker>
      ))}
    </>
  );
}
