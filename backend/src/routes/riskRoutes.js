const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { predictRisk } = require('../controllers/riskController');

router.post('/predict', asyncHandler(predictRisk));

module.exports = router;
