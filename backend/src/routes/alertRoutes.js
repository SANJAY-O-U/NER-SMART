const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getAlerts, postAlert } = require('../controllers/alertController');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { buildWriteLimiter } = require('../middleware/rateLimiter');

const writeLimiter = buildWriteLimiter();

router.get('/', asyncHandler(getAlerts));
router.post('/', writeLimiter, apiKeyAuth, asyncHandler(postAlert));

module.exports = router;
