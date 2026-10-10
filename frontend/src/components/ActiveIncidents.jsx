import StatusBadge from "./StatusBadge";
import { CheckCircleIcon } from "./icons";
import { scrollToSection } from "./Sidebar";
import { severityDisplay, timeAgo } from "../theme/status";

// Same definition the "Active Incidents" KPI uses (see KPISection.jsx): anything not yet RESOLVED.
const RESOLVED_INCIDENT_STATUSES = ["RESOLVED"];

const incidentTime = (i) => new Date(i.timestamp || i.createdAt).getTime() || 0;

/**
 * Compact operational view of the incidents that are not yet resolved, most severe first. It is a
 * read-only summary of the `incidents` the dashboard already holds (no extra request); the full list,
 * the AI analysis, "View Impact" and any status actions stay in the Incident Reports panel, which the
 * View button scrolls to. Only fields present on the incident are shown.
 */
export default function ActiveIncidents({ incidents }) {
  const safeIncidents = Array.isArray(incidents) ? incidents : [];
  const active = safeIncidents
    .filter((i) => !RESOLVED_INCIDENT_STATUSES.includes((i.status || "").toUpperCase()))
    .sort((a, b) => severityDisplay(b.severity).rank - severityDisplay(a.severity).rank || incidentTime(b) - incidentTime(a));

  if (!active.length) {
    return (
      <div className="py-8 text-center">
        <CheckCircleIcon className="h-7 w-7 mx-auto text-ok-600" />
        <p className="text-sm text-slate-600 mt-2">No active incidents in this region.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {active.map((incident) => {
        const sev = severityDisplay(incident.severity);
        return (
          <li key={incident.id} className={`rounded-md border border-slate-200 border-l-4 bg-white p-3 ${sev.bar}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <StatusBadge status={incident.severity} />
                <span className="text-sm font-semibold text-slate-800 break-words">{incident.type}</span>
              </div>
              <span className="text-xs text-slate-600 whitespace-nowrap">{timeAgo(incident.timestamp || incident.createdAt)}</span>
            </div>
            <p className="text-xs text-slate-600 mt-1 break-words">
              {incident.roadName ? incident.roadName : <span className="text-slate-600 italic">Not matched to a road</span>}
            </p>
            {incident.description && <p className="text-xs text-slate-600 mt-0.5 line-clamp-2" title={incident.description}>{incident.description}</p>}
            <div className="flex items-center justify-between mt-2">
              <StatusBadge status={incident.status} />
              <button
                type="button"
                onClick={() => scrollToSection("incidents")}
                aria-label={`View ${incident.type || "incident"} in Incident Reports`}
                className="text-xs font-semibold px-2.5 py-1 rounded-md border border-primary-200 text-primary-700 bg-white hover:bg-primary-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                View
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
