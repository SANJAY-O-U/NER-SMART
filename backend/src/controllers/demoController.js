const { runSeed } = require('../seed/seed');
const { success, failure } = require('../utils/response');
// Phase 7F allowlist predicate; lives in utils/appMode so the seed CLI can
// share it (seed.js cannot require this controller — it would be circular).
const { isDemoResetAllowed } = require('../utils/appMode');

// POST /api/demo/reset
// Wipes and re-seeds all collections to the known demo dataset, so the
// golden-path demo can be re-run reliably before every recording without
// manually editing MongoDB.
//
// Phase 7F: hardened to an explicit ALLOWLIST rather than a denylist.
// The previous check only blocked APP_MODE === 'production' — meaning an
// unset, misspelled, or unexpected APP_MODE value (e.g. a staging
// environment that forgot to set it) would silently pass through and
// wipe real data. Now this endpoint requires APP_MODE to be EXACTLY
// 'demo' — anything else, including unset, is rejected. This is a
// development/demo-only endpoint by design; it must never run
// accidentally.
async function resetDemo(req, res) {
  if (!isDemoResetAllowed(process.env.APP_MODE)) {
    return failure(
      res,
      `Demo reset is only available when APP_MODE=demo (current: ${process.env.APP_MODE || 'unset'}). This is a safety guard, not a bug.`,
      403
    );
  }
  const counts = await runSeed();
  return success(res, { message: 'Demo state reset', counts });
}

module.exports = { resetDemo, isDemoResetAllowed };
