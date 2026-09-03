const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getRoads, updateRoad } = require('../controllers/roadController');

router.get('/', asyncHandler(getRoads));
router.patch('/:id', asyncHandler(updateRoad));

module.exports = router;
