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

function RealRouteCard({ routeKey, route }) {
  if (!route) {
    return (
      <div className="text-xs bg-slate-50 border border-slate-200 rounded-md p-2 text-slate-400">
        {ROUTE_LABELS[routeKey]}: no feasible path found for this mode.
      </div>
    );
  }
  return (
    <div className="text-xs bg-teal-50 border border-teal-200 rounded-md p-2 space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-700">{ROUTE_LABELS[routeKey]}</span>
        {route.riskScore !== null && <RiskBadge score={Math.round(route.riskScore * 100)} />}
      </div>
      <p>Distance: <span className="font-semibold">{route.distanceKm} km</span></p>
      <p>{route.etaLabel?.split(" (")[0]}: <span className="font-semibold">{route.estimatedTravelMinutes} min</span></p>
      <p>
        Accessibility:{" "}
        <span className="font-semibold">
          {route.accessibilityScore !== null ? `${route.accessibilityScore}/100` : "unknown"}
        </span>{" "}
        · Confidence: {route.confidence || "—"}
      </p>
      {route.reasons?.length > 0 && (
        <ul className="text-slate-500 space-y-0.5 pt-1 border-t border-teal-200">
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
      <div className="flex rounded-md overflow-hidden border border-slate-300 text-xs">
        <button
          onClick={() => setMode("demo")}
          className={`flex-1 py-1.5 font-semibold ${mode === "demo" ? "bg-[#1C7293] text-white" : "bg-white text-slate-600"}`}
        >
          Demo
        </button>
        <button
          onClick={() => setMode("real")}
          className={`flex-1 py-1.5 font-semibold ${mode === "real" ? "bg-[#1C7293] text-white" : "bg-white text-slate-600"}`}
        >
          Real Road Network
        </button>
      </div>

      {mode === "demo" && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="text-sm border border-slate-300 rounded-md px-2 py-1.5"
              placeholder="Origin"
              value={form.origin}
              onChange={update("origin")}
            />
            <input
              className="text-sm border border-slate-300 rounded-md px-2 py-1.5"
              placeholder="Destination"
              value={form.destination}
              onChange={update("destination")}
            />
          </div>
          <select
            className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white"
            value={form.shipmentPriority}
            onChange={update("shipmentPriority")}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <button
            onClick={() => onAnalyze(form)}
            disabled={analyzing || !form.origin || !form.destination}
            className="w-full text-sm font-semibold px-3 py-2 rounded-md bg-[#1C7293] text-white hover:bg-[#155a74] disabled:opacity-50 transition"
          >
            {analyzing ? "Analyzing…" : "ANALYZE ROUTE"}
          </button>

          {error && <p className="text-xs text-red-600">{error}</p>}

          {result && (
            <div className="text-xs bg-teal-50 border border-teal-200 rounded-md p-2 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">{result.recommendedRoute}</span>
                <RiskBadge score={result.risk} />
              </div>
              <p>Distance: <span className="font-semibold">{result.distance} km</span></p>
              <p>ETA: <span className="font-semibold">{result.eta}</span></p>
              <p>Delay: <span className="font-semibold">{result.delay}</span></p>
              <p className="text-slate-500 italic">{result.reason}</p>
            </div>
          )}
        </>
      )}

      {mode === "real" && (
        <>
          <p className="text-[11px] text-slate-400">
            Coordinates default to two real, verified-connected points on the imported NH 27
            stretch — see ROUTING_ARCHITECTURE.md. Full Guwahati↔Imphal graph connectivity is not
            yet available in the current dataset.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input className="text-sm border border-slate-300 rounded-md px-2 py-1.5" placeholder="Origin lat" value={realForm.originLat} onChange={updateReal("originLat")} />
            <input className="text-sm border border-slate-300 rounded-md px-2 py-1.5" placeholder="Origin lng" value={realForm.originLng} onChange={updateReal("originLng")} />
            <input className="text-sm border border-slate-300 rounded-md px-2 py-1.5" placeholder="Dest lat" value={realForm.destLat} onChange={updateReal("destLat")} />
            <input className="text-sm border border-slate-300 rounded-md px-2 py-1.5" placeholder="Dest lng" value={realForm.destLng} onChange={updateReal("destLng")} />
          </div>
          <select
            className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white"
            value={realForm.cargoPriority}
            onChange={updateReal("cargoPriority")}
          >
            {CARGO_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <button
            onClick={analyzeReal}
            disabled={realAnalyzing}
            className="w-full text-sm font-semibold px-3 py-2 rounded-md bg-[#1C7293] text-white hover:bg-[#155a74] disabled:opacity-50 transition"
          >
            {realAnalyzing ? "Computing…" : "COMPUTE REAL ROUTE"}
          </button>

          {realError && <p className="text-xs text-red-600">Backend error: {realError}</p>}

          {realResult && !realResult.matched && (
            <div className="text-xs bg-amber-50 border border-amber-200 rounded-md p-2 text-amber-700">
              {realResult.message}
            </div>
          )}

          {realResult && realResult.matched && (
            <div className="space-y-2">
              <RealRouteCard routeKey="SAFEST_FEASIBLE" route={realResult.routes.SAFEST_FEASIBLE} />
              <RealRouteCard routeKey="BALANCED" route={realResult.routes.BALANCED} />
              <RealRouteCard routeKey="SHORTEST_FEASIBLE" route={realResult.routes.SHORTEST_FEASIBLE} />
              {realResult.notes?.safestEqualsBalanced && (
                <p className="text-[11px] text-slate-400 italic">Safest and Balanced routes are identical.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
