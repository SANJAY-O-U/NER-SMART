const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { resetDemo } = require('../controllers/demoController');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { buildWriteLimiter } = require('../middleware/rateLimiter');

const writeLimiter = buildWriteLimiter();

router.post('/reset', writeLimiter, apiKeyAuth, asyncHandler(resetDemo));

module.exports = router;
