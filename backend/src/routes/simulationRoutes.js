const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { simulateLandslide } = require('../controllers/simulationController');

router.post('/landslide', asyncHandler(simulateLandslide));

module.exports = router;
