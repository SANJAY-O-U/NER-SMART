import { useState } from "react";
import StatusBadge from "./StatusBadge";
import { getIncidentImpact } from "../services/api";

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

const STATE_COLOR = {
  OPEN: "text-emerald-700",
  RESTRICTED: "text-amber-700",
  HIGH_RISK: "text-orange-700",
  BLOCKED: "text-red-700",
  UNKNOWN: "text-slate-500",
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
 * Compact "Operational Impact" view (Phase 6H): incident -> affected
 * road -> accessibility state -> alerts. Fetched live from
 * GET /api/incidents/:id/impact — every value shown comes from the
 * backend's actual current state, never hardcoded.
 */
function OperationalImpactPanel({ impact, loading, error }) {
  if (loading) return <p className="text-xs text-slate-400 py-2">Loading impact…</p>;
  if (error) return <p className="text-xs text-red-500 py-2">{error}</p>;
  if (!impact) return null;

  const { road, accessibility, accessibilityWithoutThisIncident, alerts, routeImpactNote } = impact;

  return (
    <div className="text-xs bg-indigo-50 border border-indigo-200 rounded-md p-2.5 space-y-2 mt-1">
      <p className="font-semibold text-slate-700">Operational Impact</p>

      {road ? (
        <div>
          <p className="text-slate-600">
            Affected road: <span className="font-medium">{road.name}</span>
          </p>
          {accessibility && (
            <>
              <p>
                Accessibility:{" "}
                {accessibilityWithoutThisIncident && (
                  <span className="text-slate-400 line-through mr-1">
                    {accessibilityWithoutThisIncident.accessibilityScore ?? "—"}
                  </span>
                )}
                <span className="font-semibold">
                  {accessibility.accessibilityScore !== null ? accessibility.accessibilityScore : "—"}/100
                </span>
              </p>
              <p>
                State:{" "}
                {accessibilityWithoutThisIncident && accessibilityWithoutThisIncident.state !== accessibility.state && (
                  <span className={`font-medium mr-1 ${STATE_COLOR[accessibilityWithoutThisIncident.state] || STATE_COLOR.UNKNOWN}`}>
                    {accessibilityWithoutThisIncident.state} →
                  </span>
                )}
                <span className={`font-bold ${STATE_COLOR[accessibility.state] || STATE_COLOR.UNKNOWN}`}>
                  {accessibility.state}
                </span>{" "}
                · confidence {accessibility.confidence || "—"}
              </p>
            </>
          )}
          {accessibility?.explanation && (
            <p className="text-slate-500 italic mt-1">{accessibility.explanation}</p>
          )}
        </div>
      ) : (
        <p className="text-slate-500">No road association for this incident.</p>
      )}

      {alerts && alerts.length > 0 ? (
        <div className="pt-1 border-t border-indigo-200">
          <p className="text-slate-600 font-medium">Alerts generated:</p>
          <ul className="space-y-0.5">
            {alerts.map((a) => (
              <li key={a.id} className="text-slate-500">
                ⚠ {a.message}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-slate-400">No alerts generated for this incident yet.</p>
      )}

      <p className="text-slate-400 italic pt-1 border-t border-indigo-200">{routeImpactNote}</p>
    </div>
  );
}

/**
 * IncidentPanel
 * Shows every reported incident (driver-submitted or simulated) with its
 * AI analysis and lets an officer move it through the status workflow:
 * REPORTED -> AI_ANALYSED -> VERIFIED -> ACTION_REQUIRED -> RESOLVED.
 */
export default function IncidentPanel({ incidents, onUpdateStatus, updatingId }) {
  const safeIncidents = Array.isArray(incidents) ? incidents : [];

  const [expandedId, setExpandedId] = useState(null);
  const [impactCache, setImpactCache] = useState({});
  const [impactLoading, setImpactLoading] = useState(null);
  const [impactError, setImpactError] = useState(null);

  const toggleImpact = async (incidentId) => {
    if (expandedId === incidentId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(incidentId);
    if (impactCache[incidentId]) return;

    setImpactLoading(incidentId);
    setImpactError(null);
    try {
      const data = await getIncidentImpact(incidentId);
      setImpactCache((c) => ({ ...c, [incidentId]: data }));
    } catch (e) {
      setImpactError(e.message || "Could not load impact.");
    } finally {
      setImpactLoading(null);
    }
  };

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
        const isExpanded = expandedId === incident.id;
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
                  <span className="text-slate-500">
                    {ai.source === "REAL_AI" ? "AI classification:" : "Classification (heuristic):"}
                  </span>{" "}
                  <span className="font-semibold text-slate-700">{ai.classification}</span>
                  {ai.confidence !== null && ai.confidence !== undefined && (
                    <span className="text-slate-400"> ({Math.round(ai.confidence * 100)}% confidence)</span>
                  )}
                </p>
                {ai.summary && <p className="text-slate-600">{ai.summary}</p>}
                <p className="text-slate-400">
                  {ai.source === "REAL_AI" ? "Live AI analysis" : "Deterministic keyword fallback — no live AI model configured"}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-400">
                {SOURCE_LABEL[incident.source] || incident.source} · {timeAgo(incident.timestamp || incident.createdAt)}
              </span>
              <div className="flex items-center gap-2">
                {incident.roadId && (
                  <button
                    onClick={() => toggleImpact(incident.id)}
                    className="text-xs font-medium px-2.5 py-1 rounded-md border border-indigo-300 text-indigo-700 hover:bg-indigo-50 transition"
                  >
                    {isExpanded ? "Hide Impact" : "View Impact"}
                  </button>
                )}
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
            </div>

            {isExpanded && (
              <OperationalImpactPanel
                impact={impactCache[incident.id]}
                loading={impactLoading === incident.id}
                error={impactLoading === incident.id ? null : impactError}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
