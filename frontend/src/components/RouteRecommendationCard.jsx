import { useState } from "react";
import { RiskBadge } from "./StatusBadge";
import { recommendRealRoute } from "../services/api";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const CARGO_PRIORITIES = ["NORMAL", "IMPORTANT", "EMERGENCY"];

const ROUTE_LABELS = {
  SAFEST_FEASIBLE: "Safest Feasible",
  BALANCED: "Balanced",
  SHORTEST_FEASIBLE: "Shortest Feasible",
};

const INPUT =
  "w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";
const PRIMARY_BTN =
  "w-full text-sm font-semibold px-3 py-2 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1";

function LabeledField({ id, label, children }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-2xs font-semibold uppercase tracking-wide text-slate-600 mb-0.5">
        {label}
      </label>
      {children}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-900 break-words">{value}</p>
    </div>
  );
}

const MODEL_NOTE = "Modeled risk heuristic — not a live-traffic ETA.";

function RealRouteCard({ routeKey, route }) {
  if (!route) {
    return (
      <div className="text-xs bg-neutral-50 border border-neutral-200 rounded-md p-3 text-slate-600">
        <span className="font-semibold">{ROUTE_LABELS[routeKey]}:</span> no feasible path found for this mode.
      </div>
    );
  }
  return (
    <div className="text-xs bg-white border border-slate-200 rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-semibold text-slate-900">{ROUTE_LABELS[routeKey]}</span>
        {route.riskScore !== null && <RiskBadge score={Math.round(route.riskScore * 100)} />}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Stat label="Distance" value={`${route.distanceKm} km`} />
        <Stat label={route.etaLabel?.split(" (")[0] || "Travel time"} value={`${route.estimatedTravelMinutes} min`} />
        <Stat
          label="Accessibility"
          value={route.accessibilityScore !== null ? `${route.accessibilityScore}/100` : "unknown"}
        />
        <Stat label="Confidence" value={route.confidence || "—"} />
      </div>
      {route.reasons?.length > 0 && (
        <ul className="text-slate-600 space-y-0.5 pt-2 border-t border-slate-200">
          {route.reasons.slice(0, 4).map((r, i) => (
            <li key={i}>⚠ {r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Two route-recommendation modes:
 *   1. Demo (existing city-name catalogue, POST /api/routes/recommend) — unchanged.
 *   2. Real road network (Phase 4C — real graph, coordinates, POST /api/routes/recommend-real).
 */
export default function RouteRecommendationCard({ onAnalyze, analyzing, result, error, onRealRoute }) {
  const [mode, setMode] = useState("demo");

  const [form, setForm] = useState({
    origin: "Guwahati",
    destination: "Imphal",
    shipmentPriority: "CRITICAL",
  });
  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  // Real-network mode defaults to two REAL, verified-connected points
  // along the currently-imported NH 27 stretch (see ROUTING_ARCHITECTURE.md
  // for why Guwahati<->Imphal itself isn't graph-connected in this dataset yet).
  const [realForm, setRealForm] = useState({
    originLat: "24.8390",
    originLng: "92.8332",
    destLat: "26.3136",
    destLng: "92.7089",
    cargoPriority: "NORMAL",
  });
  const updateReal = (field) => (e) => setRealForm((f) => ({ ...f, [field]: e.target.value }));

  const [realResult, setRealResult] = useState(null);
  const [realError, setRealError] = useState(null);
  const [realAnalyzing, setRealAnalyzing] = useState(false);

  const analyzeReal = async () => {
    setRealAnalyzing(true);
    setRealError(null);
    setRealResult(null);
    try {
      const data = await recommendRealRoute({
        origin: { lat: Number(realForm.originLat), lng: Number(realForm.originLng) },
        destination: { lat: Number(realForm.destLat), lng: Number(realForm.destLng) },
        cargoPriority: realForm.cargoPriority,
      });
      setRealResult(data);
      if (data.matched && onRealRoute) {
        onRealRoute(data.routes.BALANCED?.geometry || null);
      }
    } catch (e) {
      setRealError(e.message || "Route lookup failed.");
    } finally {
      setRealAnalyzing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Route mode" className="flex rounded-md overflow-hidden border border-slate-300 text-xs">
        <button
          onClick={() => setMode("demo")}
          aria-pressed={mode === "demo"}
          className={`flex-1 py-2 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 ${mode === "demo" ? "bg-primary-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
        >
          Demo
        </button>
        <button
          onClick={() => setMode("real")}
          aria-pressed={mode === "real"}
          className={`flex-1 py-2 font-semibold border-l border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 ${mode === "real" ? "bg-primary-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
        >
          Real Road Network
        </button>
      </div>

      {mode === "demo" && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <LabeledField id="route-origin" label="Origin">
              <input id="route-origin" className={INPUT} placeholder="Origin" value={form.origin} onChange={update("origin")} />
            </LabeledField>
            <LabeledField id="route-destination" label="Destination">
              <input
                id="route-destination"
                className={INPUT}
                placeholder="Destination"
                value={form.destination}
                onChange={update("destination")}
              />
            </LabeledField>
          </div>
          <LabeledField id="route-priority" label="Shipment priority">
            <select id="route-priority" className={INPUT} value={form.shipmentPriority} onChange={update("shipmentPriority")}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </LabeledField>

          <button
            onClick={() => onAnalyze(form)}
            disabled={analyzing || !form.origin || !form.destination}
            className={PRIMARY_BTN}
          >
            {analyzing ? "Analyzing…" : "ANALYZE ROUTE"}
          </button>

          {error && <p role="alert" className="text-xs font-medium text-block-700">{error}</p>}

          {result && (
            <div className="text-xs bg-white border border-slate-200 rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <p className="text-2xs uppercase tracking-wide text-slate-500">Recommended route</p>
                  <p className="text-sm font-semibold text-slate-900">{result.recommendedRoute}</p>
                </div>
                <RiskBadge score={result.risk} />
              </div>
              <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                <Stat label="Distance" value={`${result.distance} km`} />
                <Stat label="ETA" value={result.eta} />
                <Stat label="Delay" value={result.delay} />
              </div>
              <p className="text-slate-600 italic pt-2 border-t border-slate-200">{result.reason}</p>
              <p className="text-2xs text-slate-500">{MODEL_NOTE}</p>
            </div>
          )}
        </>
      )}

      {mode === "real" && (
        <>
          <p className="text-xs text-slate-600 bg-neutral-50 border border-neutral-200 rounded-md px-2.5 py-1.5">
            Coordinates default to two real, verified-connected points on the imported NH 27
            stretch — see ROUTING_ARCHITECTURE.md. Full Guwahati↔Imphal graph connectivity is not
            yet available in the current dataset.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <LabeledField id="real-origin-lat" label="Origin lat">
              <input id="real-origin-lat" className={INPUT} placeholder="Origin lat" value={realForm.originLat} onChange={updateReal("originLat")} />
            </LabeledField>
            <LabeledField id="real-origin-lng" label="Origin lng">
              <input id="real-origin-lng" className={INPUT} placeholder="Origin lng" value={realForm.originLng} onChange={updateReal("originLng")} />
            </LabeledField>
            <LabeledField id="real-dest-lat" label="Dest lat">
              <input id="real-dest-lat" className={INPUT} placeholder="Dest lat" value={realForm.destLat} onChange={updateReal("destLat")} />
            </LabeledField>
            <LabeledField id="real-dest-lng" label="Dest lng">
              <input id="real-dest-lng" className={INPUT} placeholder="Dest lng" value={realForm.destLng} onChange={updateReal("destLng")} />
            </LabeledField>
          </div>
          <LabeledField id="real-cargo" label="Cargo priority">
            <select id="real-cargo" className={INPUT} value={realForm.cargoPriority} onChange={updateReal("cargoPriority")}>
              {CARGO_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </LabeledField>

          <button
            onClick={analyzeReal}
            disabled={realAnalyzing}
            className={PRIMARY_BTN}
          >
            {realAnalyzing ? "Computing…" : "COMPUTE REAL ROUTE"}
          </button>

          {realError && <p role="alert" className="text-xs font-medium text-block-700">Backend error: {realError}</p>}

          {realResult && !realResult.matched && (
            <div className="text-xs bg-warn-50 border border-warn-200 rounded-md p-2.5 text-warn-700">
              {realResult.message}
            </div>
          )}

          {realResult && realResult.matched && (
            <div className="space-y-2">
              <RealRouteCard routeKey="SAFEST_FEASIBLE" route={realResult.routes.SAFEST_FEASIBLE} />
              <RealRouteCard routeKey="BALANCED" route={realResult.routes.BALANCED} />
              <RealRouteCard routeKey="SHORTEST_FEASIBLE" route={realResult.routes.SHORTEST_FEASIBLE} />
              {realResult.notes?.safestEqualsBalanced && (
                <p className="text-xs text-slate-600 italic">Safest and Balanced routes are identical.</p>
              )}
              <p className="text-2xs text-slate-500">{MODEL_NOTE}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
