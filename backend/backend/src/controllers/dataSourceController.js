const { listSources } = require('../services/dataSourceRegistry');
const { success } = require('../utils/response');

// GET /api/datasources
async function getDataSources(req, res) {
  return success(res, listSources());
}

module.exports = { getDataSources };
