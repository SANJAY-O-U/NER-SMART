const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getVehicles, updateVehicleLocation } = require('../controllers/vehicleController');

router.get('/', asyncHandler(getVehicles));
router.post('/location', asyncHandler(updateVehicleLocation));

module.exports = router;
