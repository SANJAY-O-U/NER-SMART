/**
 * Weather Service
 * ---------------
 * Provider interface for IMD weather data. As of this writing,
 * IMD_ACCESS = NOT_VERIFIED (see IMD_INTEGRATION.md): direct requests to
 * api.imd.gov.in return 401, and self-service registration is gated to
 * official government email domains. This service is fully implemented
 * against IMD's documented response formats but has never made a
 * successful live call.
 *
 * Design: `fetchFn` is injectable so tests exercise the real
 * request/normalize/validate/retry logic against fixtures, with zero
 * network access — per the mission's "do not call the live IMD API in
 * unit tests" rule.
 *
 * Auth mechanism: NOT publicly documented before logging into the IMD
 * portal (the public API reference lists endpoint URLs and response
 * shapes only). We assume a bearer-token-style API key, configurable via
 * env, since that's the most common pattern for this kind of gateway —
 * but this is an UNVERIFIED ASSUMPTION. Adjust IMD_API_AUTH_HEADER /
 * IMD_API_AUTH_SCHEME once real credentials and their documented usage
 * are obtained.
 */

const { normalizeCurrentWx, normalizeAwsData, normalizeDistrictWarning } = require('./weatherValidation');
const { registerSource } = require('./dataSourceRegistry');

const IMD_BASE_URL = process.env.IMD_API_BASE_URL || 'https://api.imd.gov.in/api/v1';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRIES = 1; // one retry on transient (network/5xx) failure, per "handle transient failures"

function hasCredentials() {
  return Boolean(process.env.IMD_API_KEY);
}

function buildAuthHeaders() {
  const key = process.env.IMD_API_KEY;
  const headerName = process.env.IMD_API_AUTH_HEADER || 'Authorization';
  const scheme = process.env.IMD_API_AUTH_SCHEME || 'Bearer';
  if (!key) return {};
  return { [headerName]: scheme ? `${scheme} ${key}` : key };
}

function isTransientStatus(status) {
  return status >= 500 || status === 429;
}

/**
 * Low-level fetch wrapper: timeout + one retry on transient failure.
 * `fetchFn` defaults to the global fetch but is injectable for tests.
 * Never throws — always resolves to { ok, status, body, error }.
 */
async function fetchWithRetry(url, { fetchFn = fetch, attempt = 0 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchFn(url, {
      headers: buildAuthHeaders(),
      signal: controller.signal,
    });
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
 * Fetches and normalizes a Current Weather reading for one IMD station.
 * Returns { status: 'LIVE'|'UNAVAILABLE', observation, error }.
 * status is a REQUEST-LEVEL result here (did we get valid data), not the
 * freshness classification — see freshnessService for that.
 */
async function getCurrentWeather(stationId, { fetchFn, stationLat, stationLng } = {}) {
  if (!hasCredentials()) {
    registerSource('IMD_WEATHER', {
      status: 'UNAVAILABLE',
      source: 'IMD Current Weather API (api.imd.gov.in)',
      coverage: 'Not attempted — no IMD_API_KEY configured',
      confidence: null,
      error: 'No credentials. Registration requires an official .gov.in/.nic.in/.cdot.in/.cdac.in/.nhai.org/.icar.org.in email — see IMD_INTEGRATION.md',
    });
    return { status: 'UNAVAILABLE', observation: null, error: 'no_credentials' };
  }

  const url = `${IMD_BASE_URL}/current_wx?id=${encodeURIComponent(stationId)}`;
  const result = await fetchWithRetry(url, { fetchFn });

  if (!result.ok) {
    registerSource('IMD_WEATHER', {
      status: 'UNAVAILABLE',
      source: 'IMD Current Weather API (api.imd.gov.in)',
      coverage: `Station ${stationId}`,
      confidence: null,
      error: result.error,
    });
    return { status: 'UNAVAILABLE', observation: null, error: result.error };
  }

  const normResult = normalizeCurrentWx(result.body, { stationLat, stationLng });
  if (!normResult.valid) {
    registerSource('IMD_WEATHER', {
      status: 'UNAVAILABLE',
      source: 'IMD Current Weather API (api.imd.gov.in)',
      coverage: `Station ${stationId}`,
      confidence: null,
      error: `malformed response: ${normResult.reason}`,
    });
    return { status: 'UNAVAILABLE', observation: null, error: normResult.reason };
  }

  registerSource('IMD_WEATHER', {
    status: 'LIVE',
    source: 'IMD Current Weather API (api.imd.gov.in)',
    coverage: `Station ${stationId}`,
    confidence: 0.9,
  });

  return { status: 'LIVE', observation: normResult.normalized, error: null };
}

/** Same pattern as getCurrentWeather but for the AWS/ARG endpoint. */
async function getAwsWeather(stationId, { fetchFn } = {}) {
  if (!hasCredentials()) {
    return { status: 'UNAVAILABLE', observation: null, error: 'no_credentials' };
  }

  const url = `${IMD_BASE_URL}/aws_data?id=${encodeURIComponent(stationId)}`;
  const result = await fetchWithRetry(url, { fetchFn });

  if (!result.ok) {
    return { status: 'UNAVAILABLE', observation: null, error: result.error };
  }

  const normResult = normalizeAwsData(result.body);
  if (!normResult.valid) {
    return { status: 'UNAVAILABLE', observation: null, error: normResult.reason };
  }

  return { status: 'LIVE', observation: normResult.normalized, error: null };
}

/** District warning lookup — see normalizeDistrictWarning for shape. */
async function getDistrictWarning(districtId, { fetchFn } = {}) {
  if (!hasCredentials()) {
    return { status: 'UNAVAILABLE', warning: null, error: 'no_credentials' };
  }

  const url = `${IMD_BASE_URL}/districtwarning?id=${encodeURIComponent(districtId)}`;
  const result = await fetchWithRetry(url, { fetchFn });

  if (!result.ok) {
    return { status: 'UNAVAILABLE', warning: null, error: result.error };
  }

  const body = Array.isArray(result.body) ? result.body[0] : result.body;
  const normResult = normalizeDistrictWarning(body);
  if (!normResult.valid) {
    return { status: 'UNAVAILABLE', warning: null, error: normResult.reason };
  }

  return { status: 'LIVE', warning: normResult.normalized, error: null };
}

module.exports = {
  getCurrentWeather,
  getAwsWeather,
  getDistrictWarning,
  hasCredentials,
  fetchWithRetry, // exported for testing
};
