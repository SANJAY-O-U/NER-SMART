const mongoose = require('mongoose');

const Road = require('../models/Road');
const Vehicle = require('../models/Vehicle');
const Shipment = require('../models/Shipment');
const Incident = require('../models/Incident');
const Alert = require('../models/Alert');
const Warehouse = require('../models/Warehouse');
const Hospital = require('../models/Hospital');

const { calculateRisk } = require('../services/riskService');
const { isDemoResetAllowed } = require('../utils/appMode');

/**
 * Wipes and re-seeds all collections with the known demo dataset.
 * Assumes a MongoDB connection is already open (does NOT connect/close/exit
 * itself) so it can be called both from the CLI (`npm run seed`) and from
 * the live server via POST /api/demo/reset.
 */
async function runSeed() {
  console.log('Clearing existing collections...');
  await Promise.all([
    // Only clear demo/prototype roads (source: null). Real imported roads
    // (source set by scripts/importRoadNetwork.js) are NOT demo data and
    // must survive a demo reset — re-importing a real dataset on every
    // reset would be slow, pointless, and risks losing field-verified
    // status updates on real roads.
    Road.deleteMany({ source: null }),
    Vehicle.deleteMany({}),
    Shipment.deleteMany({}),
    Incident.deleteMany({}),
    Alert.deleteMany({}),
    Warehouse.deleteMany({}),
    Hospital.deleteMany({}),
  ]);

  // ---- Roads (North-East India corridor) ----
  const roadDefs = [
    { name: 'NH-2 Guwahati-Imphal Highway', lat: 25.5, lng: 92.8, floodRisk: 45, landslideRisk: 55 },
    { name: 'NH-37 Alternate Corridor', lat: 25.2, lng: 92.5, floodRisk: 20, landslideRisk: 18 },
    { name: 'NH-6 Silchar-Aizawl Road', lat: 24.6, lng: 92.7, floodRisk: 30, landslideRisk: 40 },
    { name: 'NH-29 Kohima-Dimapur Link', lat: 25.8, lng: 94.0, floodRisk: 15, landslideRisk: 25 },
    { name: 'NH-40 Shillong-Guwahati Pass', lat: 25.9, lng: 91.8, floodRisk: 35, landslideRisk: 30 },
  ];
  const roads = await Road.insertMany(roadDefs.map((r) => ({ ...r, status: 'OPEN' })));
  console.log(`Seeded ${roads.length} roads`);

  // ---- Shipments (with pre-computed demo routes) ----
  const shipmentDefs = [
    { cargo: 'Medical Supplies', priority: 'CRITICAL', origin: 'Guwahati', destination: 'Imphal', road: roads[1] },
    { cargo: 'Relief Food Kits', priority: 'HIGH', origin: 'Guwahati', destination: 'Imphal', road: roads[0] },
    { cargo: 'Construction Material', priority: 'LOW', origin: 'Silchar', destination: 'Aizawl', road: roads[2] },
    { cargo: 'Fuel Tankers', priority: 'MEDIUM', origin: 'Kohima', destination: 'Dimapur', road: roads[3] },
    { cargo: 'Electronics', priority: 'MEDIUM', origin: 'Shillong', destination: 'Guwahati', road: roads[4] },
  ];

  const shipments = [];
  for (const def of shipmentDefs) {
    const { risk } = calculateRisk({
      rainfallScore: def.road.floodRisk,
      slopeScore: def.road.landslideRisk,
      historicalRisk: 30,
      roadCondition: 25,
    });

    const shipment = await Shipment.create({
      cargo: def.cargo,
      priority: def.priority,
      origin: def.origin,
      destination: def.destination,
      status: 'IN_TRANSIT',
      route: {
        recommendedRoute: def.road.name.startsWith('NH-2') || def.road.name.startsWith('NH-37') ? (def.road === roads[1] ? 'Route B' : 'Route A') : def.road.name,
        roadName: def.road.name,
        distance: 430,
        eta: '10h 20m',
        risk,
        delay: '0 min',
        reason: def.road === roads[1] ? 'Lower landslide risk' : 'Direct route',
      },
    });
    shipments.push(shipment);
  }
  console.log(`Seeded ${shipments.length} shipments`);

  // ---- Vehicles (linked 1:1 to shipments) ----
  const vehicleCoords = [
    { lat: 25.4, lng: 92.6 },
    { lat: 25.55, lng: 92.85 },
    { lat: 24.7, lng: 92.75 },
    { lat: 25.75, lng: 93.95 },
    { lat: 25.85, lng: 91.85 },
  ];

  const vehicles = [];
  for (let i = 0; i < shipments.length; i += 1) {
    const vehicle = await Vehicle.create({
      shipmentId: shipments[i]._id,
      lat: vehicleCoords[i].lat,
      lng: vehicleCoords[i].lng,
      speed: 40 + i * 5,
      status: 'IN_TRANSIT',
    });
    vehicles.push(vehicle);
    shipments[i].vehicleId = vehicle._id;
    await shipments[i].save();
  }
  console.log(`Seeded ${vehicles.length} vehicles`);

  // ---- Incidents (existing simulation dataset, source=SIMULATION) ----
  const incidentDefs = [
    { type: 'LANDSLIDE', severity: 'HIGH', lat: 25.5, lng: 92.8, description: 'Landslide reported near NH-2 checkpoint', source: 'SIMULATION', status: 'VERIFIED', roadName: 'NH-2 Guwahati-Imphal Highway' },
    { type: 'FLOOD', severity: 'MEDIUM', lat: 24.6, lng: 92.7, description: 'Rising water levels near Silchar-Aizawl road', source: 'SIMULATION', status: 'REPORTED', roadName: 'NH-6 Silchar-Aizawl Road' },
    { type: 'ROAD_DAMAGE', severity: 'LOW', lat: 25.9, lng: 91.8, description: 'Minor pothole damage reported', source: 'SIMULATION', status: 'RESOLVED', roadName: 'NH-40 Shillong-Guwahati Pass' },
    { type: 'ACCIDENT', severity: 'MEDIUM', lat: 25.8, lng: 94.0, description: 'Vehicle breakdown blocking one lane', source: 'SIMULATION', status: 'ACTION_REQUIRED', roadName: 'NH-29 Kohima-Dimapur Link' },
    { type: 'FLOOD', severity: 'HIGH', lat: 25.2, lng: 92.5, description: 'Flash flood warning issued', source: 'SIMULATION', status: 'VERIFIED', roadName: 'NH-37 Alternate Corridor' },
  ];
  const incidents = await Incident.insertMany(incidentDefs);
  console.log(`Seeded ${incidents.length} incidents`);

  // ---- Warehouses ----
  const warehouseDefs = [
    { name: 'Guwahati Central Warehouse', lat: 26.1445, lng: 91.7362, capacity: 500 },
    { name: 'Imphal Relief Depot', lat: 24.817, lng: 93.9368, capacity: 300 },
    { name: 'Silchar Storage Hub', lat: 24.8333, lng: 92.7789, capacity: 250 },
  ];
  const warehouses = await Warehouse.insertMany(warehouseDefs);
  console.log(`Seeded ${warehouses.length} warehouses`);

  // ---- Hospitals ----
  const hospitalDefs = [
    { name: 'Guwahati Medical College Hospital', lat: 26.1584, lng: 91.6486, emergencyCapable: true },
    { name: 'RIMS Imphal', lat: 24.7539, lng: 93.9298, emergencyCapable: true },
    { name: 'Silchar Medical College', lat: 24.8508, lng: 92.7789, emergencyCapable: true },
  ];
  const hospitals = await Hospital.insertMany(hospitalDefs);
  console.log(`Seeded ${hospitals.length} hospitals`);

  console.log('Seed complete.');

  return {
    roads: roads.length,
    shipments: shipments.length,
    vehicles: vehicles.length,
    incidents: incidents.length,
    warehouses: warehouses.length,
    hospitals: hospitals.length,
  };
}

/**
 * Phase 8B.1: the seed CLI wipes incidents, alerts, shipments, vehicles,
 * warehouses, hospitals and demo roads in whatever database MONGO_URI
 * names, so — like POST /api/demo/reset — it only runs when APP_MODE is
 * exactly 'demo'. Returns an actionable error message, or null if allowed.
 */
function seedCliRefusal(appMode) {
  if (isDemoResetAllowed(appMode)) return null;
  return (
    `Refusing to seed: APP_MODE is "${appMode || 'unset'}", but the seed wipes and re-creates demo data ` +
    'and only runs when APP_MODE=demo. Point MONGO_URI at a development database and set APP_MODE=demo to seed. ' +
    'No database connection was opened.'
  );
}

// CLI entry point: `npm run seed`. Not used when imported by the server.
if (require.main === module) {
  require('dotenv').config();

  // Checked BEFORE connecting, so a refused run performs zero DB access.
  const refusal = seedCliRefusal(process.env.APP_MODE);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }

  const connectDB = require('../config/db');

  connectDB()
    .then(() => runSeed())
    .then(() => mongoose.connection.close())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}

module.exports = { runSeed, seedCliRefusal };
