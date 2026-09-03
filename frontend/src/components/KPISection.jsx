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

export default function KPISection({ shipments = [], roads = [], vehicles = [] }) {
  const activeShipments = shipments.filter((s) =>
    ACTIVE_STATUSES.includes((s.status || "").toUpperCase())
  ).length;

  const atRiskRoads = roads.filter((r) => roadRiskScore(r) >= 31).length;

  const blockedRoads = roads.filter(
    (r) => (r.status || "").toUpperCase() === "BLOCKED"
  ).length;

  const vehicleCount = vehicles.length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KPICard label="Active Shipments" value={activeShipments} color="teal" icon="🚚" />
      <KPICard label="At Risk" value={atRiskRoads} color="amber" icon="⚠️" />
      <KPICard label="Blocked Roads" value={blockedRoads} color="red" icon="⛔" />
      <KPICard label="Vehicles" value={vehicleCount} color="slate" icon="📍" />
    </div>
  );
}
