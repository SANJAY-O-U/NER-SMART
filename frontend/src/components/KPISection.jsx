import KPICard from "./KPICard";

const ACTIVE_STATUSES = ["IN_TRANSIT", "PENDING", "ACTIVE"];
const RESOLVED_INCIDENT_STATUSES = ["RESOLVED"];

/**
 * "At risk" is derived from road data (average of floodRisk / landslideRisk)
 * since the Shipment schema doesn't carry its own risk score. This mirrors
 * the same MEDIUM/HIGH thresholds used by the backend risk formula
 * (31-60 = MEDIUM, 61-100 = HIGH) — see RISK FORMULA in the architecture doc.
 *
 * Phase 6F: this baseline flood/landslide average and the "Blocked" KPI's
 * `road.status` field below are BOTH distinct from the authoritative,
 * evidence-based accessibility engine (accessibilityEngine.js, surfaced
 * per-road in RoadRiskCard's "Operational Accessibility" block once a
 * road is selected — never batch-computed across all roads here, per the
 * engine's own performance guidance). These KPI tiles intentionally stay
 * as fast, always-available summary counts over static Road fields; their
 * labels are worded to avoid implying they ARE the accessibility state.
 */
function roadRiskScore(road) {
  return Math.round(((road.floodRisk || 0) + (road.landslideRisk || 0)) / 2);
}

export default function KPISection({ shipments, roads, vehicles, incidents, alerts, dataSources }) {
  // Defensive: props should always be arrays, but a malformed API response
  // upstream shouldn't be able to crash this component.
  const safeShipments = Array.isArray(shipments) ? shipments : [];
  const safeRoads = Array.isArray(roads) ? roads : [];
  const safeVehicles = Array.isArray(vehicles) ? vehicles : [];
  const safeIncidents = Array.isArray(incidents) ? incidents : [];
  const safeAlerts = Array.isArray(alerts) ? alerts : [];
  const safeDataSources = Array.isArray(dataSources) ? dataSources : [];

  const activeShipments = safeShipments.filter((s) =>
    ACTIVE_STATUSES.includes((s.status || "").toUpperCase())
  ).length;

  const atRiskRoads = safeRoads.filter((r) => roadRiskScore(r) >= 31).length;

  const blockedRoads = safeRoads.filter(
    (r) => (r.status || "").toUpperCase() === "BLOCKED"
  ).length;

  const activeIncidents = safeIncidents.filter(
    (i) => !RESOLVED_INCIDENT_STATUSES.includes((i.status || "").toUpperCase())
  ).length;

  const liveSourceCount = safeDataSources.filter((s) => s.status === "LIVE").length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
      <KPICard label="Roads" value={safeRoads.length} color="slate" icon="🛣️" />
      <KPICard label="At Risk (Baseline)" value={atRiskRoads} color="amber" icon="⚠️" />
      <KPICard label="Blocked (Manual)" value={blockedRoads} color="red" icon="⛔" />
      <KPICard label="Active Incidents" value={activeIncidents} color="red" icon="🚧" />
      <KPICard label="Active Alerts" value={safeAlerts.length} color="amber" icon="🔔" />
      <KPICard label="Active Shipments" value={activeShipments} color="brand" icon="🚚" />
      <KPICard label="Vehicles" value={safeVehicles.length} color="slate" icon="📍" />
      <KPICard
        label="Data Sources"
        value={safeDataSources.length ? `${liveSourceCount}/${safeDataSources.length} Live` : "—"}
        color="emerald"
        icon="📡"
      />
    </div>
  );
}
