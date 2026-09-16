const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getIncidents, getIncident, createIncident, updateIncidentStatus } = require('../controllers/incidentController');
const { getIncidentImpact } = require('../controllers/incidentImpactController');

router.get('/', asyncHandler(getIncidents));
router.get('/:id/impact', asyncHandler(getIncidentImpact));
router.get('/:id', asyncHandler(getIncident));
router.post('/', asyncHandler(createIncident));
router.patch('/:id', asyncHandler(updateIncidentStatus));

module.exports = router;
