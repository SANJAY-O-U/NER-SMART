const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getAlerts, postAlert } = require('../controllers/alertController');

router.get('/', asyncHandler(getAlerts));
router.post('/', asyncHandler(postAlert));

module.exports = router;
