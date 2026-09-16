import KPICard from "./KPICard";

const ACTIVE_STATUSES = ["IN_TRANSIT", "PENDING", "ACTIVE"];

/**
 * "At risk" is derived from road data (average of floodRisk / landslideRisk)
 * since the Shipment schema doesn't carry its own risk score. This mirrors
 * the same MEDIUM/HIGH thresholds used by the backend risk formula
 * (31-60 = MEDIUM, 61-100 = HIGH) — see RISK FORMULA in the architecture doc.
 */
function roadRiskScore(road) {
  return Math.round(((road.floodRisk || 0) + (road.landslideRisk || 0)) / 2);
}

export default function KPISection({ shipments, roads, vehicles }) {
  // Defensive: props should always be arrays, but a malformed API response
  // upstream shouldn't be able to crash this component.
  const safeShipments = Array.isArray(shipments) ? shipments : [];
  const safeRoads = Array.isArray(roads) ? roads : [];
  const safeVehicles = Array.isArray(vehicles) ? vehicles : [];

  const activeShipments = safeShipments.filter((s) =>
    ACTIVE_STATUSES.includes((s.status || "").toUpperCase())
  ).length;

  const atRiskRoads = safeRoads.filter((r) => roadRiskScore(r) >= 31).length;

  const blockedRoads = safeRoads.filter(
    (r) => (r.status || "").toUpperCase() === "BLOCKED"
  ).length;

  const vehicleCount = safeVehicles.length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KPICard label="Active Shipments" value={activeShipments} color="teal" icon="🚚" />
      <KPICard label="At Risk" value={atRiskRoads} color="amber" icon="⚠️" />
      <KPICard label="Blocked Roads" value={blockedRoads} color="red" icon="⛔" />
      <KPICard label="Vehicles" value={vehicleCount} color="slate" icon="📍" />
    </div>
  );
}
