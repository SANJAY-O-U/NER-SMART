const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getRoads, updateRoad } = require('../controllers/roadController');
const { getNearestRoad } = require('../controllers/locationController');
const { getRoadAccessibility } = require('../controllers/accessibilityController');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { buildWriteLimiter } = require('../middleware/rateLimiter');
const { validateObjectIdParam } = require('../utils/validators');

const writeLimiter = buildWriteLimiter();

router.get('/nearest', asyncHandler(getNearestRoad));
router.get('/', asyncHandler(getRoads));
router.get('/:roadId/accessibility', asyncHandler(getRoadAccessibility));
router.patch('/:id', writeLimiter, apiKeyAuth, validateObjectIdParam('id'), asyncHandler(updateRoad));

module.exports = router;
