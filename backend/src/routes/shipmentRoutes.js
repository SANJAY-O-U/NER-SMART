const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getShipments, getShipmentById, createShipment } = require('../controllers/shipmentController');

router.get('/', asyncHandler(getShipments));
router.get('/:id', asyncHandler(getShipmentById));
router.post('/', asyncHandler(createShipment));

module.exports = router;
