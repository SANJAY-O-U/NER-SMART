const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { simulateLandslide } = require('../controllers/simulationController');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { buildWriteLimiter } = require('../middleware/rateLimiter');

const writeLimiter = buildWriteLimiter();

// Write endpoint (mutates Road/Shipment/Alert documents) — see
// simulationController.js for the additional APP_MODE + demo-road-only
// safety guards layered on top of the API key gate.
router.post('/landslide', writeLimiter, apiKeyAuth, asyncHandler(simulateLandslide));

module.exports = router;
