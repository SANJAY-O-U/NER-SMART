/**
 * API Key Write Gate (Phase 1 — Production Safety Hardening)
 * -------------------------------------------------------------
 * Minimal shared-secret gate for application write endpoints. NOT a full
 * auth system by design (no accounts, no JWT, no roles) — see
 * POST_PPT_PRODUCTION_AUDIT for why this is the deliberately smallest
 * safe solution for this phase.
 *
 * `isValidApiKey` is a pure, directly-testable predicate; `apiKeyAuth` is
 * the thin Express wrapper around it, matching this codebase's existing
 * style of keeping business logic out of the framework layer
 * (e.g. weatherService.hasCredentials()).
 *
 * Fails CLOSED: if NER_API_KEY is unset, every request is rejected —
 * never silently open. A deployment that forgot to configure a key is
 * broken loudly, not insecure silently.
 */

function isValidApiKey(providedKey) {
  const configured = process.env.NER_API_KEY;
  if (!configured) return false;
  return typeof providedKey === 'string' && providedKey.length > 0 && providedKey === configured;
}

/** Express middleware — never logs or echoes the provided/configured key. */
function apiKeyAuth(req, res, next) {
  const provided = req.get('x-api-key');
  if (!isValidApiKey(provided)) {
    return res.status(401).json({ success: false, error: 'Missing or invalid API key' });
  }
  return next();
}

module.exports = { apiKeyAuth, isValidApiKey };
