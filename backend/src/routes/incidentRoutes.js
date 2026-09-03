const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getIncidents, createIncident } = require('../controllers/incidentController');

router.get('/', asyncHandler(getIncidents));
router.post('/', asyncHandler(createIncident));

module.exports = router;
