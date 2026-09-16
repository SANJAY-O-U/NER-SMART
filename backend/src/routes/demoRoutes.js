const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { resetDemo } = require('../controllers/demoController');

router.post('/reset', asyncHandler(resetDemo));

module.exports = router;
