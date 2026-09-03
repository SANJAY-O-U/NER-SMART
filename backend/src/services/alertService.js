const Alert = require('../models/Alert');

/**
 * Creates and persists a single alert. Shared so alert-creation logic
 * (e.g. from the landslide simulation) isn't duplicated across controllers.
 */
async function createAlert({ type = 'GENERAL', severity = 'MEDIUM', message, shipmentId = null }) {
  return Alert.create({ type, severity, message, shipmentId });
}

/**
 * Creates one alert per shipment (used when a road block affects multiple
 * shipments at once).
 */
async function createAlertsForShipments(shipmentIds, { type, severity, messageFor }) {
  const alerts = await Promise.all(
    shipmentIds.map((id) =>
      createAlert({
        type,
        severity,
        shipmentId: id,
        message: typeof messageFor === 'function' ? messageFor(id) : messageFor,
      })
    )
  );
  return alerts;
}

module.exports = { createAlert, createAlertsForShipments };
