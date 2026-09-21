import { useCallback, useEffect, useState } from "react";
import Header from "../components/Header";
import KPISection from "../components/KPISection";
import Card from "../components/Card";
import ShipmentTable from "../components/ShipmentTable";
import AlertPanel from "../components/AlertPanel";
import RoadRiskCard from "../components/RoadRiskCard";
import RouteRecommendationCard from "../components/RouteRecommendationCard";
import IncidentPanel from "../components/IncidentPanel";
import DataSourceStatus from "../components/DataSourceStatus";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorMessage from "../components/ErrorMessage";
// Supplied by Member 2 — Map/GIS developer. Do not implement this here.
import MapView from "../components/map/MapView";
import {
  getShipments,
  getVehicles,
  getRoads,
  getAlerts,
  getIncidents,
  updateIncidentStatus,
  recommendRoute,
  simulateLandslide,
  getDataSources,
  getWeatherForRoad,
  getDisasterContextForRoad,
  getRoadAccessibility,
  resetDemo,
} from "../services/api";

// Poll interval for picking up new driver-reported incidents without
// building a full WebSocket layer (P0 scope — see mission doc "REALTIME").
const INCIDENT_POLL_MS = 6000;

export default function Dashboard() {
  const [shipments, setShipments] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [roads, setRoads] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [updatingIncidentId, setUpdatingIncidentId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedShipmentId, setSelectedShipmentId] = useState(null);
  const [selectedRoadId, setSelectedRoadId] = useState(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [routeResult, setRouteResult] = useState(null);
  const [realRouteGeometry, setRealRouteGeometry] = useState(null);
  const [routeError, setRouteError] = useState(null);

  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState(null);
  const [simulationError, setSimulationError] = useState(null);

  const [dataSources, setDataSources] = useState([]);
  const [roadWeather, setRoadWeather] = useState(null);
  const [disasterContext, setDisasterContext] = useState(null);
  const [accessibility, setAccessibility] = useState(null);

  // Demo-reset-only state (Phase: fresh demo reset workflow). resetting/
  // resetError drive the Header's RESET DEMO button; incidentPanelKey is
  // incremented on every reset to force IncidentPanel to remount — the
  // simplest, safest way to clear its own internal state (expanded row,
  // cached impact fetches) without reaching into that component.
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState(null);
  const [incidentPanelKey, setIncidentPanelKey] = useState(0);

  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [shipmentsData, vehiclesData, roadsData, alertsData, incidentsData] = await Promise.all([
        getShipments(),
        getVehicles(),
        getRoads(),
        getAlerts(),
        getIncidents(),
      ]);
      // api.js already normalizes these to arrays, but guard here too in
      // case a future endpoint change slips through — a bad shape should
      // never crash the dashboard.
      const safeShipments = Array.isArray(shipmentsData) ? shipmentsData : [];
      const safeVehicles = Array.isArray(vehiclesData) ? vehiclesData : [];
      const safeRoads = Array.isArray(roadsData) ? roadsData : [];
      const safeAlerts = Array.isArray(alertsData) ? alertsData : [];
      const safeIncidents = Array.isArray(incidentsData) ? incidentsData : [];

      setShipments(safeShipments);
      setVehicles(safeVehicles);
      setRoads(safeRoads);
      setAlerts(safeAlerts);
      setIncidents(safeIncidents);
      setSelectedRoadId((current) => current || safeRoads[0]?.id || null);
    } catch (err) {
      setError(err.message || "Failed to load dashboard data.");
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Data source health (Phase 2) — fetched once; these change slowly
  // (registered at backend startup), no need to poll.
  useEffect(() => {
    getDataSources()
      .then(setDataSources)
      .catch(() => {
        // Non-critical panel — a failure here shouldn't disrupt the dashboard.
      });
  }, []);

  // Weather context for whichever road is selected in the Road Risk card.
  useEffect(() => {
    if (!selectedRoadId) {
      setRoadWeather(null);
      return;
    }
    let cancelled = false;
    getWeatherForRoad(selectedRoadId)
      .then((data) => {
        if (!cancelled) setRoadWeather(data);
      })
      .catch(() => {
        if (!cancelled) setRoadWeather(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoadId]);

  // Disaster (NDMA SACHET) context for whichever road is selected.
  useEffect(() => {
    if (!selectedRoadId) {
      setDisasterContext(null);
      return;
    }
    let cancelled = false;
    getDisasterContextForRoad(selectedRoadId)
      .then((data) => {
        if (!cancelled) setDisasterContext(data);
      })
      .catch(() => {
        if (!cancelled) setDisasterContext(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoadId]);

  // Dynamic accessibility (Phase 4B) for whichever road is selected —
  // fuses road status, SACHET, weather, and field-incident evidence.
  useEffect(() => {
    if (!selectedRoadId) {
      setAccessibility(null);
      return;
    }
    let cancelled = false;
    getRoadAccessibility(selectedRoadId)
      .then((data) => {
        if (!cancelled) setAccessibility(data);
      })
      .catch(() => {
        if (!cancelled) setAccessibility(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoadId]);

  // Fix (frontend-only, no business logic touched): a landslide
  // simulation's result/error belongs only to the road it was run for.
  // Without this, switching the road dropdown could leave a previous
  // road's stale SIMULATE result visible under a newly-selected road.
  useEffect(() => {
    setSimulationResult(null);
    setSimulationError(null);
  }, [selectedRoadId]);

  // Lightweight polling so a driver-reported incident shows up on the
  // dashboard without the officer manually refreshing. Silent refresh only
  // touches incidents to avoid flashing the rest of the dashboard.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const incidentsData = await getIncidents();
        setIncidents(Array.isArray(incidentsData) ? incidentsData : []);
      } catch {
        // Ignore transient polling errors — next tick will retry.
      }
    }, INCIDENT_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const handleUpdateIncidentStatus = async (incidentId, status) => {
    setUpdatingIncidentId(incidentId);
    try {
      const updated = await updateIncidentStatus(incidentId, status);
      setIncidents((current) =>
        current.map((inc) => (inc.id === incidentId ? { ...inc, ...updated } : inc))
      );
    } catch (err) {
      setError(err.message || "Failed to update incident status.");
    } finally {
      setUpdatingIncidentId(null);
    }
  };

  const handleAnalyzeRoute = async (form) => {
    setAnalyzing(true);
    setRouteError(null);
    try {
      const result = await recommendRoute(form);
      setRouteResult(result);
    } catch (err) {
      setRouteError(err.message || "Route analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSimulateLandslide = async (roadId) => {
    if (!roadId) return;
    setSimulating(true);
    setSimulationError(null);
    try {
      const result = await simulateLandslide({ roadId });
      setSimulationResult(result);
      // Road status, shipment routes, and alerts all change server-side —
      // refresh in the background so the dashboard reflects the new state.
      await loadAll({ silent: true });
    } catch (err) {
      setSimulationError(err.message || "Simulation failed.");
    } finally {
      setSimulating(false);
    }
  };

  // Fresh demo reset workflow: calls the EXISTING, APP_MODE=demo-guarded
  // POST /api/demo/reset (unchanged — it already wipes/reseeds incidents,
  // alerts, and demo-only roads/shipments/vehicles correctly; see
  // DEMO_RUN.md). This handler's only job is making the DASHBOARD reflect
  // that fresh backend state immediately, rather than waiting on the next
  // 6s incident poll or a stale selectedRoadId pointing at a road that no
  // longer exists after reseeding.
  const handleResetDemo = async () => {
    setResetting(true);
    setResetError(null);
    try {
      await resetDemo();

      // Clear every piece of transient, selection-dependent state BEFORE
      // reloading — otherwise a stale selectedRoadId (the old prototype
      // road's Mongo _id no longer exists post-reseed) would keep the
      // now-orphaned accessibility/weather/disaster-context data on
      // screen instead of re-resolving against the fresh roads list.
      setSelectedShipmentId(null);
      setSelectedRoadId(null);
      setRouteResult(null);
      setRouteError(null);
      setRealRouteGeometry(null);
      setSimulationResult(null);
      setSimulationError(null);
      setRoadWeather(null);
      setDisasterContext(null);
      setAccessibility(null);
      setIncidentPanelKey((k) => k + 1); // forces IncidentPanel to remount, clearing its own internal state

      await loadAll();
      // Data sources rarely change, but a reset is a natural moment to
      // confirm the dashboard is showing current backend state, not a
      // hardcoded/leftover value.
      getDataSources()
        .then(setDataSources)
        .catch(() => {});
    } catch (err) {
      setResetError(err.message || "Demo reset failed.");
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header onRefresh={() => loadAll({ silent: true })} refreshing={refreshing} onResetDemo={handleResetDemo} resetting={resetting} resetError={resetError} />
        <LoadingSpinner label="Loading command center…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header onRefresh={() => loadAll({ silent: true })} refreshing={refreshing} onResetDemo={handleResetDemo} resetting={resetting} resetError={resetError} />
        <ErrorMessage message={error} onRetry={() => loadAll()} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header onRefresh={() => loadAll({ silent: true })} refreshing={refreshing} onResetDemo={handleResetDemo} resetting={resetting} resetError={resetError} />

      <main className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-[1600px] mx-auto">
        {/* OPERATIONAL OVERVIEW — compact KPI row, all values from real fetched state */}
        <KPISection
          shipments={shipments}
          roads={roads}
          vehicles={vehicles}
          incidents={incidents}
          alerts={alerts}
          dataSources={dataSources}
        />

        {/* MAIN WORKSPACE — map is the visual anchor; alerts are the most
            visually prominent dynamic panel alongside it. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            <Card title="NER Map" subtitle="Real road geometry · incidents · facilities" className="h-[440px] p-0 overflow-hidden">
              <MapView
                roads={roads}
                vehicles={vehicles}
                incidents={incidents}
                facilities={[]}
                onRoadClick={(road) => console.log(road)}
                heightClassName="h-full"
                routeGeometry={realRouteGeometry}
              />
            </Card>

            <Card title="Shipments">
              <ShipmentTable
                shipments={shipments}
                vehicles={vehicles}
                selectedId={selectedShipmentId}
                onSelectShipment={(s) => setSelectedShipmentId(s.id)}
              />
            </Card>
          </div>

          <Card title="Operational Alerts" subtitle="Live from the backend alert pipeline">
            <AlertPanel alerts={alerts} roads={roads} />
          </Card>
        </div>

        {/* SECOND ROW — road-level accessibility/risk alongside the
            incident-level operational impact trace. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <Card title="Road Intelligence" subtitle="Accessibility · risk · evidence · confidence">
            <RoadRiskCard
              roads={roads}
              selectedRoadId={selectedRoadId}
              onSelectRoad={setSelectedRoadId}
              onSimulate={handleSimulateLandslide}
              simulating={simulating}
              simulationResult={simulationResult}
              simulationError={simulationError}
              weather={roadWeather}
              disasterContext={disasterContext}
              accessibility={accessibility}
            />
          </Card>

          <Card title="Incident Reports" subtitle="Operational impact per incident" className="max-h-[520px] overflow-hidden">
            <IncidentPanel
              key={incidentPanelKey}
              incidents={incidents}
              onUpdateStatus={handleUpdateIncidentStatus}
              updatingId={updatingIncidentId}
            />
          </Card>
        </div>

        {/* ROUTE RECOMMENDATIONS */}
        <Card title="Route Recommendations" subtitle="Modeled risk heuristic — not a live-traffic ETA">
          <RouteRecommendationCard
            onAnalyze={handleAnalyzeRoute}
            analyzing={analyzing}
            result={routeResult}
            error={routeError}
            onRealRoute={setRealRouteGeometry}
          />
        </Card>

        {/* DATA SOURCES / SYSTEM HEALTH */}
        <Card title="Data Sources · System Health" subtitle="Status reported directly by the backend — never inferred here">
          <DataSourceStatus sources={dataSources} />
        </Card>
      </main>
    </div>
  );
}
