import StatusBadge, { RiskBadge } from "./StatusBadge";
import { accessibilityDisplay, roadStatusDisplay, effectiveRoadStatus, isImportedRoad } from "../theme/status";

/** One label/value pair in the road identification grid. Renders an explicit "not available" rather than a blank. */
function Field({ label, value, unavailable = "Not available" }) {
  const has = value !== undefined && value !== null && value !== "";
  return (
    <div className="min-w-0">
      <dt className="text-2xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-sm break-words ${has ? "font-medium text-slate-800" : "text-slate-500 italic"}`}>
        {has ? value : unavailable}
      </dd>
    </div>
  );
}

/** "✓ OPEN" / "? UNKNOWN (unverified)" for a stored status field; undefined (shown as "Not available") when absent. */
function storedStatusText(value) {
  if (!value) return undefined;
  const info = roadStatusDisplay(value);
  return `${info.glyph} ${info.label}${info.label === "UNKNOWN" ? " (unverified)" : ""}`;
}

/** The legacy `status` field (the landslide simulation writes BLOCKED here). On an imported road OPEN is just the importer default. */
function legacyStatusText(road) {
  if (!road.status) return undefined;
  const info = roadStatusDisplay(road.status);
  const ignored = isImportedRoad(road) && info.label === "OPEN" ? " (importer default, not evidence)" : "";
  return `${info.glyph} ${info.label}${ignored}`;
}

function SectionTitle({ children }) {
  return <p className="text-2xs font-bold uppercase tracking-wider text-slate-600">{children}</p>;
}

/**
 * Lets the user pick a road, see its current risk, and trigger the
 * SIMULATE LANDSLIDE demo flow (POST /api/simulation/landslide).
 * Phase 10.5.3: the demo control is only rendered when `onSimulate` is
 * provided (never in a read-only deployment).
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
    return <p className="text-sm text-slate-600 py-4 text-center">No road data available.</p>;
  }

  return (
    <div className="space-y-3">
      <label htmlFor="road-select" className="block text-2xs font-bold uppercase tracking-wider text-slate-600">
        Road
      </label>
      <select
        id="road-select"
        className="w-full scroll-mt-28 text-sm border border-slate-500 rounded-md px-2 py-1.5 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
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
        <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <h3 className="text-base font-semibold leading-tight text-slate-900">{selectedRoad.name}</h3>
            <StatusBadge status={effectiveRoadStatus(selectedRoad)} />
          </div>
          <p className="text-2xs text-slate-600 -mt-1.5">
            Stored road status (the most restrictive of the sources below). Operational accessibility is evaluated
            separately, further down.
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Field label="Road ID" value={selectedRoad.id} />
            <Field label="District" value={selectedRoad.district} unavailable="Not assigned" />
            <Field label="State" value={selectedRoad.state} />
            <Field label="Corridor" value={selectedRoad.corridor} />
            <Field label="Source" value={selectedRoad.source} />
            <Field label="Source vintage" value={selectedRoad.sourceVintage} />
            <Field label="Physical status" value={storedStatusText(selectedRoad.physicalStatus)} />
            <Field label="Official status" value={storedStatusText(selectedRoad.officialStatus)} />
            <Field label="Field status" value={storedStatusText(selectedRoad.fieldStatus)} />
            <Field label="Legacy / simulated status" value={legacyStatusText(selectedRoad)} />
          </dl>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 pt-2 border-t border-slate-200">
            <div>
              Flood risk: <span className="font-semibold text-slate-800">{selectedRoad.floodRisk ?? "-"}</span>
            </div>
            <div>
              Landslide risk: <span className="font-semibold text-slate-800">{selectedRoad.landslideRisk ?? "-"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">Overall (baseline):</span>
            {selectedRoad.floodRisk == null && selectedRoad.landslideRisk == null ? (
              <span className="text-xs text-slate-500 italic">Not available — no risk data for this road</span>
            ) : (
              <RiskBadge score={avgRisk} />
            )}
          </div>
        </div>
      )}

      {onSimulate && (
        <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/60 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-2xs font-bold tracking-wide px-1.5 py-0.5 rounded bg-amber-200 text-amber-800">
              WHAT-IF / DEMO
            </span>
            <span className="text-2xs text-slate-600">Does not reflect a real event</span>
          </div>
          <button
            type="button"
            onClick={() => onSimulate(selectedRoad?.id)}
            disabled={!selectedRoad || simulating}
            className="w-full text-sm font-semibold px-3 py-2 rounded-md border border-amber-400 bg-white text-amber-800 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {simulating ? "Simulating…" : "RUN LANDSLIDE SIMULATION"}
          </button>
        </div>
      )}

      {simulationError && <p role="alert" className="text-xs font-medium text-block-700">{simulationError}</p>}

      {accessibility && (
        <div className={`text-xs border rounded-md p-3 space-y-2 ${accessibilityDisplay(accessibility.state).panel}`}>
          <div className="flex items-center justify-between gap-2">
            <SectionTitle>Operational Accessibility</SectionTitle>
            <span className="text-xs font-semibold text-slate-700">
              {accessibility.accessibilityScore !== null && accessibility.accessibilityScore !== undefined
                ? `${accessibility.accessibilityScore} / 100`
                : "Score unavailable"}
            </span>
          </div>
          <p className="text-2xs text-slate-600 italic -mt-1">
            Road status and evidence-based accessibility are evaluated separately.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-sm font-bold ${accessibilityDisplay(accessibility.state).text}`}>
              <span aria-hidden="true">{accessibilityDisplay(accessibility.state).glyph}</span>
              {accessibilityDisplay(accessibility.state).label}
            </span>
            <span className="text-slate-500">({accessibility.state})</span>
            <span className="text-slate-600">Confidence: {accessibility.confidence || "—"}</span>
          </div>
          {accessibility.factors && accessibility.factors.length > 0 && (
            <ul className="space-y-0.5 pt-1 border-t border-black/10">
              {accessibility.factors.slice(0, 4).map((f, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span aria-hidden="true">{f.contribution !== null && f.contribution < 0 ? "⚠" : "✓"}</span>
                  <span className="sr-only">{f.contribution !== null && f.contribution < 0 ? "Negative factor:" : "Supporting factor:"}</span>
                  <span className="text-slate-600">
                    {f.name?.replace(/_/g, " ")} — {f.source}
                    {f.contribution !== null ? ` (${f.contribution})` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-slate-600 italic pt-1 border-t border-black/10">{accessibility.explanation}</p>
        </div>
      )}

      {weather && (
        <div className="text-xs bg-white border border-slate-200 rounded-md p-3 space-y-1">
          <SectionTitle>Weather context</SectionTitle>
          {weather.weather ? (
            <>
              <p>
                {weather.weather.weatherCondition || "Condition unknown"} ·{" "}
                {weather.weather.rainfallMm !== null ? `${weather.weather.rainfallMm}mm rainfall` : "rainfall n/a"}
              </p>
              <p className="text-slate-500">
                Source: {weather.weather.source} · {weather.distanceToStationKm}km away · {weather.matchConfidence} confidence
              </p>
              <p className="text-slate-500">Freshness: {weather.freshness}</p>
              {weather.weather.observedAt && (
                <p className="text-slate-500">Observed: {new Date(weather.weather.observedAt).toLocaleString()}</p>
              )}
            </>
          ) : (
            <p className="text-slate-600 bg-neutral-50 border border-neutral-200 rounded px-2 py-1">
              Weather unavailable{weather.reason ? ` — ${weather.reason}` : ""}
            </p>
          )}
        </div>
      )}

      {disasterContext && (
        <div className="text-xs bg-white border border-slate-200 rounded-md p-3 space-y-2">
          <SectionTitle>
            Disaster context {disasterContext.district ? `— ${disasterContext.district}` : ""}
          </SectionTitle>
          {disasterContext.activeAlertCount > 0 ? (
            disasterContext.alerts.map((a) => (
              <div key={a.id} className="border-t border-slate-200 pt-1.5 first:border-t-0 first:pt-0">
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
          ) : disasterContext.feed && disasterContext.feed.status !== "LIVE" ? (
            // Phase 8C.7: zero alerts while the feed is down is "unknown", not "all clear".
            <p className="text-slate-700 bg-neutral-50 border border-neutral-300 rounded px-2 py-1">
              NDMA SACHET feed currently {String(disasterContext.feed.status).toLowerCase()} — no current disaster data for this road (not an all-clear).
            </p>
          ) : !disasterContext.district ? (
            <p className="text-slate-500">No district assigned to this road — SACHET alerts cannot be matched to it.</p>
          ) : (
            <p className="text-slate-500">No active NDMA SACHET alerts for this district.</p>
          )}
        </div>
      )}

      {simulationResult && (
        <div className="text-xs bg-block-50 border border-block-200 rounded-md p-2 space-y-1">
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
