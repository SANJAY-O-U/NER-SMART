import { useState } from "react";
import { RiskBadge } from "./StatusBadge";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/**
 * Small form + ANALYZE ROUTE button that calls POST /api/routes/recommend
 * and renders the recommended route back to the user.
 */
export default function RouteRecommendationCard({ onAnalyze, analyzing, result, error }) {
  const [form, setForm] = useState({
    origin: "Guwahati",
    destination: "Imphal",
    shipmentPriority: "CRITICAL",
  });

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className="space-y-3">
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
          <p>
            Distance: <span className="font-semibold">{result.distance} km</span>
          </p>
          <p>
            ETA: <span className="font-semibold">{result.eta}</span>
          </p>
          <p>
            Delay: <span className="font-semibold">{result.delay}</span>
          </p>
          <p className="text-slate-500 italic">{result.reason}</p>
        </div>
      )}
    </div>
  );
}
