/**
 * Centralized API layer for the NER-SMART frontend.
 *
 * Every backend call in the app goes through the functions exported here.
 * Components should never call `fetch` directly — this keeps the API
 * contract in one place and makes it easy to swap transports later.
 *
 * Base URL comes from Vite env: set VITE_API_BASE_URL in frontend/.env
 * (see .env.example). Falls back to a sane local default.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

// Phase 1.5 — Client Compatibility. Must match the backend's NER_API_KEY
// for local development (see .env.example). Only ever attached to
// state-changing requests (see WRITE_METHODS below) — GET requests never
// send it, matching the backend's own public-GET-by-default design.
const API_KEY = import.meta.env.VITE_API_KEY;
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const method = (options.method || "GET").toUpperCase();

  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (WRITE_METHODS.has(method) && API_KEY) {
    headers["x-api-key"] = API_KEY;
  }

  // options spread first, headers applied last, so the fully-merged
  // headers object above always wins regardless of whether a caller
  // passes its own `options.headers`.
  const config = { ...options, headers };

  let response;
  try {
    response = await fetch(url, config);
  } catch (networkErr) {
    // Backend unreachable, CORS issue, offline, etc.
    throw new ApiError(
      "Network error — is the backend running?",
      0,
      networkErr.message
    );
  }

  // Some endpoints may return empty bodies (e.g. 204). Guard against that.
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!response.ok) {
    const message =
      (data && data.message) || `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, data);
  }

  return data;
}

/**
 * Backends commonly wrap list responses (e.g. `{ data: [...] }` or
 * `{ shipments: [...] }`) instead of returning a bare array. This
 * normalizes any of those shapes to a plain array so components can
 * always assume `.filter`/`.find`/`.map` are safe to call, regardless
 * of how the backend teammate formatted the response.
 */
function toArray(payload, ...keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (payload && Array.isArray(payload[key])) return payload[key];
  }
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

/* ---------------- Shipments ---------------- */
export const getShipments = () =>
  request("/shipments").then((data) => toArray(data, "shipments"));
export const getShipment = (id) => request(`/shipments/${id}`);
export const createShipment = (payload) =>
  request("/shipments", { method: "POST", body: JSON.stringify(payload) });

/* ---------------- Vehicles ---------------- */
export const getVehicles = () =>
  request("/vehicles").then((data) => toArray(data, "vehicles"));
export const postVehicleLocation = (payload) =>
  request("/vehicles/location", { method: "POST", body: JSON.stringify(payload) });

/* ---------------- Roads ---------------- */
export const getRoads = () =>
  request("/roads").then((data) => toArray(data, "roads"));
export const updateRoad = (id, payload) =>
  request(`/roads/${id}`, { method: "PATCH", body: JSON.stringify(payload) });

/* ---------------- Incidents ---------------- */
export const getIncidents = () =>
  request("/incidents").then((data) => toArray(data, "incidents"));
export const createIncident = (payload) =>
  request("/incidents", { method: "POST", body: JSON.stringify(payload) });
export const updateIncidentStatus = (id, status) =>
  request(`/incidents/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }).then(
    (data) => (data && data.data) || data
  );

/* ---------------- Data Sources ---------------- */
export const getDataSources = () =>
  request("/datasources").then((data) => toArray(data, "datasources"));

/* ---------------- Weather ---------------- */
export const getWeatherForRoad = (roadId) =>
  request(`/weather/road/${roadId}`).then((data) => (data && data.data) || data);

/* ---------------- SACHET disaster alerts ---------------- */
export const getSachetAlerts = () =>
  request("/sachet/alerts").then((data) => toArray(data, "alerts"));
export const getDisasterContextForRoad = (roadId) =>
  request(`/sachet/road/${roadId}`).then((data) => (data && data.data) || data);

/* ---------------- Accessibility ---------------- */
export const getRoadAccessibility = (roadId) =>
  request(`/roads/${roadId}/accessibility`).then((data) => (data && data.data) || data);

/* ---------------- Incident Impact (Phase 6) ---------------- */
export const getIncidentImpact = (incidentId) =>
  request(`/incidents/${incidentId}/impact`).then((data) => (data && data.data) || data);

/* ---------------- Demo ---------------- */
export const resetDemo = () => request("/demo/reset", { method: "POST" });

/* ---------------- Alerts ---------------- */
export const getAlerts = () =>
  request("/alerts").then((data) => toArray(data, "alerts"));
export const createAlert = (payload) =>
  request("/alerts", { method: "POST", body: JSON.stringify(payload) });

/* ---------------- Risk engine ---------------- */
export const predictRisk = (payload) =>
  request("/risk/predict", { method: "POST", body: JSON.stringify(payload) });

/* ---------------- Routing ---------------- */
export const recommendRoute = (payload) =>
  request("/routes/recommend", { method: "POST", body: JSON.stringify(payload) });

// Phase 4C — real, graph-based routing over the imported road network.
export const recommendRealRoute = (payload) =>
  request("/routes/recommend-real", { method: "POST", body: JSON.stringify(payload) }).then(
    (data) => (data && data.data) || data
  );

/* ---------------- Simulation ---------------- */
export const simulateLandslide = (payload) =>
  request("/simulation/landslide", { method: "POST", body: JSON.stringify(payload) });
