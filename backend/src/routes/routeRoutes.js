const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { recommend } = require('../controllers/routeController');

router.post('/recommend', asyncHandler(recommend));

module.exports = router;
