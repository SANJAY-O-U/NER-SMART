import { useState } from "react";
import StatusBadge from "./StatusBadge";
import { accessibilityDisplay, severityDisplay } from "../theme/status";
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
function OperationalImpactPanel({ id, impact, loading, error }) {
  if (loading) return <p id={id} role="status" className="text-xs text-slate-600 py-2">Loading impact…</p>;
  if (error) return <p id={id} role="alert" className="text-xs text-block-700 py-2">{error}</p>;
  if (!impact) return null;

  const { road, accessibility, accessibilityWithoutThisIncident, alerts, routeImpactNote } = impact;

  return (
    <div id={id} className="text-xs bg-primary-50/50 border border-primary-200 rounded-md p-2.5 space-y-2 mt-1">
      <p className="font-semibold text-slate-800 uppercase tracking-wide text-2xs">Operational Impact</p>

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
                  <span className="text-slate-500 line-through mr-1">
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
                  <span className={`font-medium mr-1 ${accessibilityDisplay(accessibilityWithoutThisIncident.state).text}`}>
                    {accessibilityWithoutThisIncident.state} →
                  </span>
                )}
                <span className={`font-bold ${accessibilityDisplay(accessibility.state).text}`}>
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
        <div className="pt-1 border-t border-slate-200">
          <p className="text-slate-600 font-medium">Alerts generated:</p>
          <ul className="space-y-0.5">
            {alerts.map((a) => (
              <li key={a.id} className="text-slate-500">
                <span aria-hidden="true">⚠</span> {a.message}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-slate-500">No alerts generated for this incident yet.</p>
      )}

      <p className="text-slate-500 italic pt-1 border-t border-slate-200">{routeImpactNote}</p>
    </div>
  );
}

/**
 * IncidentPanel
 * Shows every reported incident (driver-submitted or simulated) with its
 * AI analysis and lets an officer move it through the status workflow:
 * REPORTED -> AI_ANALYSED -> VERIFIED -> ACTION_REQUIRED -> RESOLVED.
 *
 * Phase 10.5.3: without `onUpdateStatus` (read-only deployment — no
 * browser write key) the workflow buttons are hidden and no protected
 * PATCH is ever attempted. `updateError` shows a failed update here,
 * inside the panel, instead of replacing the whole dashboard.
 */
export default function IncidentPanel({ incidents, onUpdateStatus, updatingId, updateError }) {
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
    <ul className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
      {!onUpdateStatus && (
        <li className="pb-2 text-xs text-slate-600 bg-neutral-50 border border-neutral-200 rounded-md px-2.5 py-1.5 mb-2">
          Read-only in this deployment — incident status changes are not available from this dashboard.
        </li>
      )}
      {updateError && <li role="alert" className="py-2 text-xs font-medium text-block-700">{updateError}</li>}
      {sorted.map((incident) => {
        const flow = STATUS_FLOW[incident.status];
        const ai = incident.aiResult;
        const isExpanded = expandedId === incident.id;
        return (
          <li
            key={incident.id}
            className={`rounded-md border border-slate-200 border-l-4 bg-white p-3 space-y-1.5 ${severityDisplay(incident.severity).bar}`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-slate-900">{incident.type}</span>
                <StatusBadge status={incident.severity} />
                {incident.source === "DRIVER_APP" && (
                  <span className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 border border-neutral-200">
                    DRIVER REPORT
                  </span>
                )}
                {incident.locationMode && (
                  <span
                    className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${
                      incident.locationMode === "LIVE_GPS"
                        ? "bg-ok-50 text-ok-700 border border-ok-200"
                        : "bg-neutral-100 text-neutral-700 border border-neutral-300"
                    }`}
                  >
                    {incident.locationMode === "LIVE_GPS" ? "LIVE GPS" : "NER DEMO"}
                  </span>
                )}
              </div>
              <StatusBadge status={incident.status} />
            </div>

            {incident.roadName && (
              <p className="text-xs text-slate-600">Road: <span className="font-medium text-slate-700">{incident.roadName}</span></p>
            )}

            {incident.description && (
              <p className="text-sm text-slate-700">{incident.description}</p>
            )}

            {ai && ai.classification && (
              <div className="text-xs bg-neutral-50 border border-neutral-200 rounded-md p-2 space-y-0.5">
                <p>
                  <span className="text-slate-500">
                    {ai.source === "REAL_AI" ? "AI classification:" : "Classification (heuristic):"}
                  </span>{" "}
                  <span className="font-semibold text-slate-700">{ai.classification}</span>
                  {ai.confidence !== null && ai.confidence !== undefined && (
                    <span className="text-slate-500"> ({Math.round(ai.confidence * 100)}% confidence)</span>
                  )}
                </p>
                {ai.summary && <p className="text-slate-600">{ai.summary}</p>}
                {ai.rationale && <p className="text-slate-500 italic">{ai.rationale}</p>}
                <p className="text-slate-500">
                  {ai.source === "REAL_AI" ? "Live AI analysis" : "Deterministic keyword fallback — no live AI model configured"}
                  {" — AI assistance only, not the road's official status"}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
              <span className="text-xs text-slate-600" title={(incident.timestamp || incident.createdAt) ? new Date(incident.timestamp || incident.createdAt).toLocaleString() : undefined}>
                {SOURCE_LABEL[incident.source] || incident.source} · {timeAgo(incident.timestamp || incident.createdAt)}
              </span>
              <div className="flex items-center gap-2">
                {incident.roadId && (
                  <button
                    type="button"
                    onClick={() => toggleImpact(incident.id)}
                    aria-expanded={isExpanded}
                    aria-controls={isExpanded ? `incident-impact-${incident.id}` : undefined}
                    className="text-xs font-semibold px-2.5 py-1 rounded-md border border-primary-500 text-primary-700 hover:bg-primary-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    {isExpanded ? "Hide Impact" : "View Impact"}
                  </button>
                )}
                {flow && onUpdateStatus && (
                  <button
                    type="button"
                    onClick={() => onUpdateStatus(incident.id, flow.next)}
                    aria-label={`${flow.label}: ${incident.type || "incident"}`}
                    disabled={updatingId === incident.id}
                    className="text-xs font-semibold px-2.5 py-1 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
                  >
                    {updatingId === incident.id ? "Updating…" : flow.label}
                  </button>
                )}
              </div>
            </div>

            {isExpanded && (
              <OperationalImpactPanel
                id={`incident-impact-${incident.id}`}
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
