const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getDataSources } = require('../controllers/dataSourceController');

router.get('/', asyncHandler(getDataSources));

module.exports = router;
