import StatusBadge from "./StatusBadge";

const SOURCE_LABEL = {
  SIMULATION: "Simulation",
  FIELD_INCIDENT: "Field Report",
  DISASTER_ALERT: "SACHET",
};

function timeAgo(timestamp) {
  if (!timestamp) return "";
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

/**
 * Scrollable list of alerts, newest first, color-coded by severity.
 * `roads` (optional) is used only to resolve an alert's roadId into a
 * readable road name — same data the dashboard already fetches, no new
 * request. Every field shown (severity, type, source, road, reason,
 * timestamp) comes directly from the Alert document; nothing here is
 * invented when a field is absent.
 */
export default function AlertPanel({ alerts, roads = [] }) {
  const safeAlerts = Array.isArray(alerts) ? alerts : [];
  const safeRoads = Array.isArray(roads) ? roads : [];

  if (!safeAlerts.length) {
    return (
      <div className="py-8 text-center">
        <p className="text-3xl mb-1">✅</p>
        <p className="text-sm text-slate-500">No active operational alerts.</p>
      </div>
    );
  }

  const sorted = [...safeAlerts].sort(
    (a, b) => new Date(b.generatedAt || b.timestamp) - new Date(a.generatedAt || a.timestamp)
  );

  const roadName = (alert) => {
    if (!alert.roadId) return null;
    const match = safeRoads.find((r) => r.id === alert.roadId || r.id === alert.roadId?.toString?.());
    return match?.name || null;
  };

  return (
    <ul className="space-y-2.5 max-h-80 overflow-y-auto">
      {sorted.map((a) => {
        const road = roadName(a);
        return (
          <li key={a.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={a.severity} />
                <span className="text-xs font-medium text-slate-500">{a.type}</span>
                {a.source && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                    {SOURCE_LABEL[a.source] || a.source}
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-400 whitespace-nowrap">{timeAgo(a.generatedAt || a.timestamp)}</span>
            </div>
            <p className="text-sm text-slate-700 mt-1.5">{a.message}</p>
            {(road || a.triggerReason) && (
              <p className="text-xs text-slate-500 mt-1">
                {road && <span className="font-medium">{road}</span>}
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
