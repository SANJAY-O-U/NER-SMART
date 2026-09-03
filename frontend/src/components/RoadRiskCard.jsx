import StatusBadge, { RiskBadge } from "./StatusBadge";

/**
 * Lets the user pick a road, see its current risk, and trigger the
 * SIMULATE LANDSLIDE demo flow (POST /api/simulation/landslide).
 */
export default function RoadRiskCard({
  roads = [],
  selectedRoadId,
  onSelectRoad,
  onSimulate,
  simulating,
  simulationResult,
  simulationError,
}) {
  const selectedRoad = roads.find((r) => r.id === selectedRoadId) || roads[0];
  const avgRisk = selectedRoad
    ? Math.round(((selectedRoad.floodRisk || 0) + (selectedRoad.landslideRisk || 0)) / 2)
    : 0;

  if (!roads.length) {
    return <p className="text-sm text-slate-500 py-4 text-center">No road data available.</p>;
  }

  return (
    <div className="space-y-3">
      <select
        className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white"
        value={selectedRoad?.id || ""}
        onChange={(e) => onSelectRoad(e.target.value)}
      >
        {roads.map((r) => (
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
