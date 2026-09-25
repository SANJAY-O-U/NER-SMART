const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const { getShipments, getShipmentById, createShipment } = require('../controllers/shipmentController');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { buildWriteLimiter } = require('../middleware/rateLimiter');

const writeLimiter = buildWriteLimiter();

router.get('/', asyncHandler(getShipments));
router.get('/:id', asyncHandler(getShipmentById));
router.post('/', writeLimiter, apiKeyAuth, asyncHandler(createShipment));

module.exports = router;
