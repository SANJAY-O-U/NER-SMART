import StatusBadge from "./StatusBadge";
import { CheckCircleIcon } from "./icons";
import { severityDisplay, timeAgo } from "../theme/status";

const SOURCE_LABEL = {
  SIMULATION: "Simulation",
  FIELD_INCIDENT: "Field Report",
  DISASTER_ALERT: "SACHET",
};

/** ROAD_BLOCKED -> "Road blocked": a display transform of the stored enum, nothing is invented. */
function humanize(value) {
  if (!value) return "";
  const text = String(value).replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const alertTime = (a) => new Date(a.generatedAt || a.timestamp).getTime() || 0;

/**
 * Alert list, most severe first and newest first within a severity, each row marked by a severity bar
 * and a text severity badge. `roads` (optional) is used only to resolve an alert's roadId into a
 * readable road name — same data the dashboard already fetches, no new request. Every field shown
 * (severity, type, source, road, reason, timestamp) comes directly from the Alert document; nothing
 * here is invented when a field is absent.
 */
export default function AlertPanel({ alerts, roads = [] }) {
  const safeAlerts = Array.isArray(alerts) ? alerts : [];
  const safeRoads = Array.isArray(roads) ? roads : [];

  if (!safeAlerts.length) {
    return (
      <div className="py-8 text-center">
        <CheckCircleIcon className="h-7 w-7 mx-auto text-ok-600" />
        <p className="text-sm text-slate-600 mt-2">No active operational alerts.</p>
      </div>
    );
  }

  const sorted = [...safeAlerts].sort(
    (a, b) => severityDisplay(b.severity).rank - severityDisplay(a.severity).rank || alertTime(b) - alertTime(a)
  );

  const roadName = (alert) => {
    if (!alert.roadId) return null;
    const match = safeRoads.find((r) => r.id === alert.roadId || r.id === alert.roadId?.toString?.());
    return match?.name || null;
  };

  return (
    <ul className="space-y-2">
      {sorted.map((a) => {
        const road = roadName(a);
        const sev = severityDisplay(a.severity);
        return (
          <li key={a.id} className={`rounded-md border border-slate-200 border-l-4 bg-white p-3 ${sev.bar}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={a.severity} />
                <span className="text-xs font-medium text-slate-600" title={a.type}>
                  {humanize(a.type)}
                </span>
                {a.source && (
                  <span className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600 border border-neutral-200">
                    {SOURCE_LABEL[a.source] || a.source}
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-500 whitespace-nowrap">{timeAgo(a.generatedAt || a.timestamp)}</span>
            </div>
            <p className="text-sm font-medium text-slate-800 mt-1.5">{a.message}</p>
            {(road || a.triggerReason) && (
              <p className="text-xs text-slate-500 mt-1">
                {road && <span className="font-medium text-slate-600">{road}</span>}
                {road && a.triggerReason && " — "}
                {a.triggerReason}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
