import { useCallback, useEffect, useState } from "react";
import Header from "../components/Header";
import KPISection from "../components/KPISection";
import Card from "../components/Card";
import ShipmentTable from "../components/ShipmentTable";
import AlertPanel from "../components/AlertPanel";
import RoadRiskCard from "../components/RoadRiskCard";
import RouteRecommendationCard from "../components/RouteRecommendationCard";
import LoadingSpinner from "../components/LoadingSpinner";
import ErrorMessage from "../components/ErrorMessage";
// Supplied by Member 2 — Map/GIS developer. Do not implement this here.
import MapView from "../components/map/MapView";
import {
  getShipments,
  getVehicles,
  getRoads,
  getAlerts,
  recommendRoute,
  simulateLandslide,
} from "../services/api";

export default function Dashboard() {
  const [shipments, setShipments] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [roads, setRoads] = useState([]);
  const [alerts, setAlerts] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedShipmentId, setSelectedShipmentId] = useState(null);
  const [selectedRoadId, setSelectedRoadId] = useState(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [routeResult, setRouteResult] = useState(null);
  const [routeError, setRouteError] = useState(null);

  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState(null);
  const [simulationError, setSimulationError] = useState(null);

  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [shipmentsData, vehiclesData, roadsData, alertsData] = await Promise.all([
        getShipments(),
        getVehicles(),
        getRoads(),
        getAlerts(),
      ]);
      setShipments(shipmentsData || []);
      setVehicles(vehiclesData || []);
      setRoads(roadsData || []);
      setAlerts(alertsData || []);
      setSelectedRoadId((current) => current || (roadsData && roadsData[0]?.id) || null);
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
              <MapView roads={roads} vehicles={vehicles} shipments={shipments} />
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
              />
            </Card>

            <Card title="Route Recommendation">
              <RouteRecommendationCard
                onAnalyze={handleAnalyzeRoute}
                analyzing={analyzing}
                result={routeResult}
                error={routeError}
              />
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
