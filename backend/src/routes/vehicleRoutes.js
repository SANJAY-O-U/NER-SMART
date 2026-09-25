const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getVehicles, updateVehicleLocation } = require('../controllers/vehicleController');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { buildWriteLimiter } = require('../middleware/rateLimiter');

const writeLimiter = buildWriteLimiter();

router.get('/', asyncHandler(getVehicles));
router.post('/location', writeLimiter, apiKeyAuth, asyncHandler(updateVehicleLocation));

module.exports = router;
