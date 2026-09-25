const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { runIngestion, getActiveAlerts, getDisasterContextForRoad } = require('../controllers/sachetController');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { buildWriteLimiter } = require('../middleware/rateLimiter');

const writeLimiter = buildWriteLimiter();

// Write: persists DisasterAlert documents. Reads remain public.
router.post('/ingest', writeLimiter, apiKeyAuth, asyncHandler(runIngestion));
router.get('/alerts', asyncHandler(getActiveAlerts));
router.get('/road/:roadId', asyncHandler(getDisasterContextForRoad));

module.exports = router;
