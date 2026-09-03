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
  const config = {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  };

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

/* ---------------- Shipments ---------------- */
export const getShipments = () => request("/shipments");
export const getShipment = (id) => request(`/shipments/${id}`);
export const createShipment = (payload) =>
  request("/shipments", { method: "POST", body: JSON.stringify(payload) });

/* ---------------- Vehicles ---------------- */
export const getVehicles = () => request("/vehicles");
export const postVehicleLocation = (payload) =>
  request("/vehicles/location", { method: "POST", body: JSON.stringify(payload) });

/* ---------------- Roads ---------------- */
export const getRoads = () => request("/roads");
export const updateRoad = (id, payload) =>
  request(`/roads/${id}`, { method: "PATCH", body: JSON.stringify(payload) });

/* ---------------- Incidents ---------------- */
export const getIncidents = () => request("/incidents");
export const createIncident = (payload) =>
  request("/incidents", { method: "POST", body: JSON.stringify(payload) });

/* ---------------- Alerts ---------------- */
export const getAlerts = () => request("/alerts");
export const createAlert = (payload) =>
  request("/alerts", { method: "POST", body: JSON.stringify(payload) });

/* ---------------- Risk engine ---------------- */
export const predictRisk = (payload) =>
  request("/risk/predict", { method: "POST", body: JSON.stringify(payload) });

/* ---------------- Routing ---------------- */
export const recommendRoute = (payload) =>
  request("/routes/recommend", { method: "POST", body: JSON.stringify(payload) });

/* ---------------- Simulation ---------------- */
export const simulateLandslide = (payload) =>
  request("/simulation/landslide", { method: "POST", body: JSON.stringify(payload) });
