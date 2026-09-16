const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getWeatherForRoad } = require('../controllers/weatherController');

router.get('/road/:roadId', asyncHandler(getWeatherForRoad));

module.exports = router;
