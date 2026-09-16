const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { runIngestion, getActiveAlerts, getDisasterContextForRoad } = require('../controllers/sachetController');

router.post('/ingest', asyncHandler(runIngestion));
router.get('/alerts', asyncHandler(getActiveAlerts));
router.get('/road/:roadId', asyncHandler(getDisasterContextForRoad));

module.exports = router;
