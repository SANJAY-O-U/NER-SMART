const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getIncidents, getIncident, createIncident, updateIncidentStatus } = require('../controllers/incidentController');

router.get('/', asyncHandler(getIncidents));
router.get('/:id', asyncHandler(getIncident));
router.post('/', asyncHandler(createIncident));
router.patch('/:id', asyncHandler(updateIncidentStatus));

module.exports = router;
