import StatusBadge, { RiskBadge } from "./StatusBadge";

const STATE_STYLE = {
  OPEN: "bg-emerald-50 border-emerald-200",
  RESTRICTED: "bg-amber-50 border-amber-200",
  HIGH_RISK: "bg-orange-50 border-orange-200",
  BLOCKED: "bg-red-50 border-red-200",
  UNKNOWN: "bg-slate-50 border-slate-200",
};

/**
 * Lets the user pick a road, see its current risk, and trigger the
 * SIMULATE LANDSLIDE demo flow (POST /api/simulation/landslide).
 */
export default function RoadRiskCard({
  roads,
  selectedRoadId,
  onSelectRoad,
  onSimulate,
  simulating,
  simulationResult,
  simulationError,
  weather,
  disasterContext,
  accessibility,
}) {
  const safeRoads = Array.isArray(roads) ? roads : [];
  const selectedRoad = safeRoads.find((r) => r.id === selectedRoadId) || safeRoads[0];
  const avgRisk = selectedRoad
    ? Math.round(((selectedRoad.floodRisk || 0) + (selectedRoad.landslideRisk || 0)) / 2)
    : 0;

  if (!safeRoads.length) {
    return <p className="text-sm text-slate-500 py-4 text-center">No road data available.</p>;
  }

  return (
    <div className="space-y-3">
      <select
        className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white"
        value={selectedRoad?.id || ""}
        onChange={(e) => onSelectRoad(e.target.value)}
      >
        {safeRoads.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>

      {selectedRoad && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">{selectedRoad.name}</span>
            <StatusBadge status={selectedRoad.status} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
            <div>
              Flood risk: <span className="font-semibold text-slate-700">{selectedRoad.floodRisk ?? "-"}</span>
            </div>
            <div>
              Landslide risk:{" "}
              <span className="font-semibold text-slate-700">{selectedRoad.landslideRisk ?? "-"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Overall:</span>
            <RiskBadge score={avgRisk} />
          </div>
        </div>
      )}

      <button
        onClick={() => onSimulate(selectedRoad?.id)}
        disabled={!selectedRoad || simulating}
        className="w-full text-sm font-semibold px-3 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition"
      >
        {simulating ? "Simulating…" : "SIMULATE LANDSLIDE"}
      </button>

      {simulationError && <p className="text-xs text-red-600">{simulationError}</p>}

      {accessibility && (
        <div
          className={`text-xs border rounded-md p-2 space-y-1.5 ${
            STATE_STYLE[accessibility.state] || STATE_STYLE.UNKNOWN
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-700">Accessibility</span>
            <span className="text-[11px] font-semibold">
              {accessibility.accessibilityScore !== null ? `${accessibility.accessibilityScore} / 100` : "—"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm">{accessibility.state}</span>
            <span className="text-slate-500">Confidence: {accessibility.confidence || "—"}</span>
          </div>
          {accessibility.factors && accessibility.factors.length > 0 && (
            <ul className="space-y-0.5 pt-1 border-t border-black/10">
              {accessibility.factors.slice(0, 4).map((f, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span>{f.contribution !== null && f.contribution < 0 ? "⚠" : "✓"}</span>
                  <span className="text-slate-600">
                    {f.name?.replace(/_/g, " ")} — {f.source}
                    {f.contribution !== null ? ` (${f.contribution})` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-slate-500 italic pt-1 border-t border-black/10">{accessibility.explanation}</p>
        </div>
      )}

      {weather && (
        <div className="text-xs bg-sky-50 border border-sky-200 rounded-md p-2 space-y-1">
          <p className="font-semibold text-slate-700">Weather context</p>
          {weather.weather ? (
            <>
              <p>
                {weather.weather.weatherCondition || "Condition unknown"} ·{" "}
                {weather.weather.rainfallMm !== null ? `${weather.weather.rainfallMm}mm/24hr` : "rainfall n/a"}
              </p>
              <p className="text-slate-500">
                Source: {weather.weather.source} · {weather.distanceToStationKm}km away · {weather.matchConfidence} confidence
              </p>
              <p className="text-slate-500">Freshness: {weather.freshness}</p>
            </>
          ) : (
            <p className="text-slate-500">
              IMD weather unavailable{weather.reason ? ` — ${weather.reason}` : ""}
            </p>
          )}
        </div>
      )}

      {disasterContext && (
        <div className="text-xs bg-amber-50 border border-amber-200 rounded-md p-2 space-y-2">
          <p className="font-semibold text-slate-700">
            Disaster context {disasterContext.district ? `— ${disasterContext.district}` : ""}
          </p>
          {disasterContext.activeAlertCount > 0 ? (
            disasterContext.alerts.map((a) => (
              <div key={a.id} className="border-t border-amber-200 pt-1.5 first:border-t-0 first:pt-0">
                <p className="font-medium text-slate-700">{a.event || "Alert"}</p>
                <p className="text-slate-500">
                  Severity: {a.severity || "Unknown"} · Urgency: {a.urgency || "Unknown"} · Certainty: {a.certainty || "Unknown"}
                </p>
                <p className="text-slate-500">
                  Source: NDMA SACHET ({a.sender || "unknown sender"}) · {disasterContext.districtAssignmentMethod === "NEAREST_DISTRICT_HQ_APPROXIMATION" ? "approximate district match" : a.associationMethod} · {a.associationConfidence || "—"} confidence
                </p>
                {a.instruction && <p className="text-slate-600 italic">{a.instruction}</p>}
              </div>
            ))
          ) : (
            <p className="text-slate-500">No active NDMA SACHET alerts for this district.</p>
          )}
        </div>
      )}

      {simulationResult && (
        <div className="text-xs bg-red-50 border border-red-200 rounded-md p-2 space-y-1">
          <p>
            Road status: <span className="font-semibold">{simulationResult.roadStatus}</span>
          </p>
          <p>
            Affected shipments:{" "}
            <span className="font-semibold">{simulationResult.affectedShipments}</span>
          </p>
          <p>
            New route: <span className="font-semibold">{simulationResult.newRoute}</span>
          </p>
          <p>
            Alerts created: <span className="font-semibold">{simulationResult.alertsCreated}</span>
          </p>
        </div>
      )}
    </div>
  );
}
