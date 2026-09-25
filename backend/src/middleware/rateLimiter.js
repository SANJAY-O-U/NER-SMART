/**
 * Rate Limiting (Phase 1 — Production Safety Hardening)
 * ---------------------------------------------------------
 * Two tiers, both env-configurable, both built on `express-rate-limit`:
 *
 *   generalLimiter — lenient, applied to every request (app.js). Default
 *     300 requests / 15 min per IP — well above the dashboard's own 6s
 *     incident-poll (~10 req/min from one browser session), so normal
 *     reads are never throttled.
 *
 *   writeLimiter — stricter, applied only alongside apiKeyAuth on write
 *     routes. Default 30 requests / 15 min per IP.
 *
 * `buildRateLimitOptions` is the pure, directly-testable piece (env
 * parsing + defaults); the actual request-counting/429 behavior is
 * `express-rate-limit`'s own well-tested internals, exercised via live
 * verification rather than re-testing a third-party library here — same
 * principle this codebase already applies to `cors`/`mongoose` etc.
 */

const rateLimit = require('express-rate-limit');

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * @param {object} [env] - defaults to process.env, injectable for tests.
 */
function buildRateLimitOptions(env = process.env) {
  const windowMinutes = toPositiveInt(env.NER_RATE_LIMIT_WINDOW_MINUTES, 15);
  const windowMs = windowMinutes * 60 * 1000;

  return {
    windowMs,
    generalMax: toPositiveInt(env.NER_RATE_LIMIT_MAX, 300),
    writeMax: toPositiveInt(env.NER_WRITE_RATE_LIMIT_MAX, 30),
  };
}

function buildGeneralLimiter(env = process.env) {
  const { windowMs, generalMax } = buildRateLimitOptions(env);
  return rateLimit({
    windowMs,
    max: generalMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests — please slow down.' },
  });
}

function buildWriteLimiter(env = process.env) {
  const { windowMs, writeMax } = buildRateLimitOptions(env);
  return rateLimit({
    windowMs,
    max: writeMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many write requests — please slow down.' },
  });
}

module.exports = { buildRateLimitOptions, buildGeneralLimiter, buildWriteLimiter };
