import { CriticalKPI, CompactKPI } from "./KPICard";
import { BanIcon, AlertTriangleIcon } from "./icons";
import { summarizeRoadStatuses } from "../theme/status";

const ACTIVE_STATUSES = ["IN_TRANSIT", "PENDING", "ACTIVE"];
const RESOLVED_INCIDENT_STATUSES = ["RESOLVED"];

/**
 * "At risk" is derived from road data (average of floodRisk / landslideRisk)
 * since the Shipment schema doesn't carry its own risk score. This mirrors
 * the same MEDIUM/HIGH thresholds used by the backend risk formula
 * (31-60 = MEDIUM, 61-100 = HIGH) — see RISK FORMULA in the architecture doc.
 *
 * Phase 6F: this baseline flood/landslide average and the stored-status counts below
 * (Blocked, Unverified) are BOTH distinct from the authoritative,
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

  // Phase 10: counted with the SAME stored-status policy the map, popup and legend use
  // (theme/status.js), so the tile can never disagree with what is drawn. It is stored status, not an
  // accessibility verdict. UNKNOWN is its own count, never folded into blocked or open.
  const roadStatusSummary = summarizeRoadStatuses(safeRoads);
  const blockedRoads = roadStatusSummary.blocked;
  const unverifiedRoads = roadStatusSummary.unknown;

  const activeIncidents = safeIncidents.filter(
    (i) => !RESOLVED_INCIDENT_STATUSES.includes((i.status || "").toUpperCase())
  ).length;

  const liveSourceCount = safeDataSources.filter((s) => s.status === "LIVE").length;

  // Presentation only: the P0 counts (blocked roads, active incidents) are prominent tiles; the
  // supporting counts are a dense grid beside them. Every value is the one computed above.
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
      <div className="grid grid-cols-2 gap-3">
        <CriticalKPI
          label="Blocked (Stored status)"
          value={blockedRoads}
          hint="Roads whose stored status (physical, official, field or simulated) is BLOCKED. Not an accessibility verdict."
          tone="block"
          active={blockedRoads > 0}
          Icon={BanIcon}
        />
        <CriticalKPI
          label="Active Incidents"
          value={activeIncidents}
          hint="Reported and not yet resolved"
          tone="block"
          active={activeIncidents > 0}
          Icon={AlertTriangleIcon}
        />
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden shadow-panel">
        <CompactKPI label="At Risk (Baseline)" value={atRiskRoads} hint="Roads with baseline flood/landslide risk of 31 or more" dot={atRiskRoads > 0 ? "warn" : undefined} />
        <CompactKPI label="Active Alerts" value={safeAlerts.length} dot={safeAlerts.length > 0 ? "warn" : undefined} />
        <CompactKPI label="Active Shipments" value={activeShipments} />
        <CompactKPI label="Roads" value={safeRoads.length} />
        <CompactKPI
          label="Unverified Roads"
          value={unverifiedRoads}
          hint="Roads with no verified status (stored status UNKNOWN). Not blocked, and not known to be safe or accessible."
          dot={unverifiedRoads > 0 ? "neutral" : undefined}
        />
        <CompactKPI label="Vehicles" value={safeVehicles.length} />
        <CompactKPI
          label="Data Sources"
          value={safeDataSources.length ? `${liveSourceCount}/${safeDataSources.length} Live` : "—"}
          hint="Sources the backend currently reports as LIVE"
          className="col-span-2 sm:col-span-3"
        />
      </dl>
    </div>
  );
}
