/**
 * CORS Allowlist (Phase 1 — Production Safety Hardening)
 * ---------------------------------------------------------
 * Replaces the previous wildcard `cors()` (every origin allowed) with an
 * explicit, environment-configured allowlist. `NER_ALLOWED_ORIGINS` is a
 * comma-separated list, e.g. "http://localhost:5173,https://dashboard.example".
 *
 * `parseAllowedOrigins`/`buildCorsOptions` are pure and directly
 * testable without spinning up Express — the `origin` callback is the
 * only piece that needs a request, and it's exercised the same way in
 * tests as `cors` itself would call it.
 */

function parseAllowedOrigins(raw) {
  return (raw || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * @param {string} [rawOrigins] - defaults to process.env.NER_ALLOWED_ORIGINS,
 *   injectable for tests.
 */
function buildCorsOptions(rawOrigins = process.env.NER_ALLOWED_ORIGINS) {
  const allowed = parseAllowedOrigins(rawOrigins);

  return {
    origin(origin, callback) {
      // No Origin header: not a browser cross-origin request (curl,
      // server-to-server, same-origin) — CORS doesn't apply, never
      // rejected here.
      if (!origin) return callback(null, true);
      if (allowed.includes(origin)) return callback(null, true);

      const err = new Error(`Origin not allowed by CORS policy: ${origin}`);
      err.status = 403;
      return callback(err);
    },
  };
}

module.exports = { buildCorsOptions, parseAllowedOrigins };
