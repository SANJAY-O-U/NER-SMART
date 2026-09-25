const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getIncidents, getIncident, createIncident, updateIncidentStatus } = require('../controllers/incidentController');
const { getIncidentImpact } = require('../controllers/incidentImpactController');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { buildWriteLimiter } = require('../middleware/rateLimiter');
const { validateObjectIdParam } = require('../utils/validators');

const writeLimiter = buildWriteLimiter();

router.get('/', asyncHandler(getIncidents));
router.get('/:id/impact', asyncHandler(getIncidentImpact));
router.get('/:id', asyncHandler(getIncident));

// POST / (incident creation) is DELIBERATELY left without the API key
// gate — see POST_PPT_PRODUCTION_AUDIT / this phase's final report for
// the full reasoning. Summary: this is the Flutter driver app's
// golden-path field-ingestion endpoint ("Driver -> here -> MongoDB" per
// the comment above createIncident), and this phase is explicitly
// forbidden from touching Flutter/GPS/offline code to add the header. A
// shared secret baked into a distributed mobile APK also wouldn't
// provide the intended protection anyway (it's trivially extractable).
// It still gets the write-rate-limiter below to bound abuse, plus the
// existing clientEventId idempotency. Proper device-level credentials
// for field ingestion are flagged as a Phase 2 follow-up, not silently
// skipped.
router.post('/', writeLimiter, asyncHandler(createIncident));

// PATCH (officer status transitions from the dashboard) DOES get the
// full gate — this is an administrative action, not field ingestion.
router.patch('/:id', writeLimiter, apiKeyAuth, validateObjectIdParam('id'), asyncHandler(updateIncidentStatus));

module.exports = router;
