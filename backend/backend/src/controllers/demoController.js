const { runSeed } = require('../seed/seed');
const { success, failure } = require('../utils/response');

// POST /api/demo/reset
// Wipes and re-seeds all collections to the known demo dataset, so the
// golden-path demo can be re-run reliably before every recording without
// manually editing MongoDB.
//
// Disabled when APP_MODE=production: production is meant to hold real
// data (real incidents, real imported roads), and this endpoint would
// silently destroy it. Demo reset only makes sense in demo mode.
async function resetDemo(req, res) {
  if (process.env.APP_MODE === 'production') {
    return failure(res, 'Demo reset is disabled when APP_MODE=production', 403);
  }
  const counts = await runSeed();
  return success(res, { message: 'Demo state reset', counts });
}

module.exports = { resetDemo };
