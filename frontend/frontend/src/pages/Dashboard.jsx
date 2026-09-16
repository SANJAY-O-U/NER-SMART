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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header onRefresh={() => loadAll({ silent: true })} refreshing={refreshing} />
        <LoadingSpinner label="Loading command center…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50">
        <Header onRefresh={() => loadAll({ silent: true })} refreshing={refreshing} />
        <ErrorMessage message={error} onRetry={() => loadAll()} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Header onRefresh={() => loadAll({ silent: true })} refreshing={refreshing} />

      <main className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-[1600px] mx-auto">
        <KPISection shipments={shipments} roads={roads} vehicles={vehicles} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            <Card title="Live Network Map" className="h-[420px] p-0 overflow-hidden">
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

          <div className="space-y-4 md:space-y-6">
            <Card title="Incident Reports" className="max-h-[480px] overflow-hidden">
              <IncidentPanel
                incidents={incidents}
                onUpdateStatus={handleUpdateIncidentStatus}
                updatingId={updatingIncidentId}
              />
            </Card>

            <Card title="Alerts">
              <AlertPanel alerts={alerts} />
            </Card>

            <Card title="Road Risk">
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

            <Card title="Route Recommendation">
              <RouteRecommendationCard
                onAnalyze={handleAnalyzeRoute}
                analyzing={analyzing}
                result={routeResult}
                error={routeError}
                onRealRoute={setRealRouteGeometry}
              />
            </Card>

            <Card title="Data Sources">
              <DataSourceStatus sources={dataSources} />
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
