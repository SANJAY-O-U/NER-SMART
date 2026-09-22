/**
 * WeatherAPI.com Provider
 * ------------------------
 * The active weather provider (see WEATHER_PROVIDER.md). Coordinate-based
 * (WeatherAPI has no station-ID concept) — mirrors weatherService.js's
 * (IMD's) fetch/timeout/retry discipline exactly, but against
 * `GET /v1/current.json?q={lat},{lng}`.
 *
 * `fetchFn` is injectable so tests exercise the real request/normalize
 * logic against fixtures, with zero network access — same rule as IMD's
 * integration.
 *
 * The API key is read from `WEATHERAPI_API_KEY` (backend/.env only) and
 * is never logged, never included in a returned result, and never sent
 * to the frontend/Flutter — it only ever appears in the outgoing request
 * URL's query string.
 */

const { normalizeWeatherApiCurrent } = require('./weatherApiValidation');

const WEATHERAPI_BASE_URL = process.env.WEATHERAPI_BASE_URL || 'https://api.weatherapi.com/v1';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 1; // one retry on transient (network/5xx) failure, same policy as IMD's integration

function hasCredentials() {
  return Boolean(process.env.WEATHERAPI_API_KEY);
}

function isTransientStatus(status) {
  return status >= 500 || status === 429;
}

/**
 * Low-level fetch wrapper: timeout + one retry on transient failure.
 * Never throws — always resolves to { ok, status, body, error }.
 */
async function fetchWithRetry(url, { fetchFn = fetch, attempt = 0 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchFn(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      if (isTransientStatus(response.status) && attempt < MAX_RETRIES) {
        return fetchWithRetry(url, { fetchFn, attempt: attempt + 1 });
      }
      return { ok: false, status: response.status, body: null, error: `HTTP ${response.status}` };
    }

    const body = await response.json();
    return { ok: true, status: response.status, body, error: null };
  } catch (err) {
    clearTimeout(timeout);
    if (attempt < MAX_RETRIES) {
      return fetchWithRetry(url, { fetchFn, attempt: attempt + 1 });
    }
    return { ok: false, status: 0, body: null, error: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

/**
 * Fetches and normalizes a Current Weather reading for one coordinate.
 * Returns { status: 'LIVE'|'UNAVAILABLE', observation, error }.
 * Never registers a data source itself — the caller (weatherController's
 * ingestion pass) aggregates across all polled locations into one
 * registry entry, same pattern as IMD's `getAwsWeather`.
 */
async function getCurrentWeather(lat, lng, { fetchFn } = {}) {
  if (!hasCredentials()) {
    return { status: 'UNAVAILABLE', observation: null, error: 'no_credentials' };
  }

  const key = process.env.WEATHERAPI_API_KEY;
  const url = `${WEATHERAPI_BASE_URL}/current.json?key=${encodeURIComponent(key)}&q=${encodeURIComponent(`${lat},${lng}`)}`;
  const result = await fetchWithRetry(url, { fetchFn });

  if (!result.ok) {
    return { status: 'UNAVAILABLE', observation: null, error: result.error };
  }

  const normResult = normalizeWeatherApiCurrent(result.body, { lat, lng });
  if (!normResult.valid) {
    return { status: 'UNAVAILABLE', observation: null, error: normResult.reason };
  }

  return { status: 'LIVE', observation: normResult.normalized, error: null };
}

module.exports = {
  getCurrentWeather,
  hasCredentials,
  fetchWithRetry, // exported for testing
};
