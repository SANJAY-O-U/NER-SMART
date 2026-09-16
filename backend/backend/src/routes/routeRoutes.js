const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { recommend } = require('../controllers/routeController');
const { recommendReal } = require('../controllers/routeGraphController');

router.post('/recommend', asyncHandler(recommend));
router.post('/recommend-real', asyncHandler(recommendReal));

module.exports = router;
