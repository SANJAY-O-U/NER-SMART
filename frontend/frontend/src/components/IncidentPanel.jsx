import StatusBadge from "./StatusBadge";

const STATUS_FLOW = {
  REPORTED: { next: "VERIFIED", label: "Verify" },
  AI_ANALYSED: { next: "VERIFIED", label: "Verify" },
  VERIFIED: { next: "ACTION_REQUIRED", label: "Mark Action Required" },
  ACTION_REQUIRED: { next: "RESOLVED", label: "Resolve" },
  RESOLVED: null,
};

const SOURCE_LABEL = {
  DRIVER_APP: "Driver App",
  SIMULATION: "Simulation",
  AUTHORITY: "Authority",
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
 * IncidentPanel
 * Shows every reported incident (driver-submitted or simulated) with its
 * AI analysis and lets an officer move it through the status workflow:
 * REPORTED -> AI_ANALYSED -> VERIFIED -> ACTION_REQUIRED -> RESOLVED.
 */
export default function IncidentPanel({ incidents, onUpdateStatus, updatingId }) {
  const safeIncidents = Array.isArray(incidents) ? incidents : [];

  if (!safeIncidents.length) {
    return <p className="text-sm text-slate-500 py-4 text-center">No incidents reported yet.</p>;
  }

  const sorted = [...safeIncidents].sort(
    (a, b) => new Date(b.timestamp || b.createdAt) - new Date(a.timestamp || a.createdAt)
  );

  return (
    <ul className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
      {sorted.map((incident) => {
        const flow = STATUS_FLOW[incident.status];
        const ai = incident.aiResult;
        return (
          <li key={incident.id} className="py-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{incident.type}</span>
                <StatusBadge status={incident.severity} />
                {incident.source === "DRIVER_APP" && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
                    DRIVER REPORT
                  </span>
                )}
                {incident.locationMode && (
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      incident.locationMode === "LIVE_GPS"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-purple-100 text-purple-700"
                    }`}
                  >
                    {incident.locationMode === "LIVE_GPS" ? "LIVE GPS" : "NER DEMO"}
                  </span>
                )}
              </div>
              <StatusBadge status={incident.status} />
            </div>

            {incident.roadName && (
              <p className="text-xs text-slate-500">Road: {incident.roadName}</p>
            )}

            {incident.description && (
              <p className="text-sm text-slate-600">{incident.description}</p>
            )}

            {ai && ai.classification && (
              <div className="text-xs bg-slate-50 border border-slate-200 rounded-md p-2 space-y-0.5">
                <p>
                  <span className="text-slate-500">AI classification:</span>{" "}
                  <span className="font-semibold text-slate-700">{ai.classification}</span>
                  {ai.confidence !== null && ai.confidence !== undefined && (
                    <span className="text-slate-400"> ({Math.round(ai.confidence * 100)}% confidence)</span>
                  )}
                </p>
                {ai.summary && <p className="text-slate-600">{ai.summary}</p>}
                <p className="text-slate-400">
                  {ai.source === "REAL_AI" ? "Live AI analysis" : "Demo AI fallback"}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-400">
                {SOURCE_LABEL[incident.source] || incident.source} · {timeAgo(incident.timestamp || incident.createdAt)}
              </span>
              {flow && (
                <button
                  onClick={() => onUpdateStatus(incident.id, flow.next)}
                  disabled={updatingId === incident.id}
                  className="text-xs font-semibold px-2.5 py-1 rounded-md bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50 transition"
                >
                  {updatingId === incident.id ? "Updating…" : flow.label}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
