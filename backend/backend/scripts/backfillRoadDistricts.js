/**
 * backfillRoadDistricts.js
 * -------------------------
 * Phase 1's road import left `district` null on every imported road (no
 * district-boundary data was available then — see DATA_PROVENANCE.md).
 * SACHET alerts are district-level, so district-level road association
 * needs SOME district value on each road.
 *
 * This script assigns an APPROXIMATE district to each real (source-set)
 * road by nearest district-HQ point — NOT a real polygon boundary join.
 * Every road updated this way gets `districtAssignmentMethod:
 * "NEAREST_DISTRICT_HQ_APPROXIMATION"` so nothing downstream can mistake
 * it for verified administrative data.
 *
 * Usage: node scripts/backfillRoadDistricts.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Road = require('../src/models/Road');
const { NER_DISTRICT_HQ_APPROX } = require('../src/config/nerGeography');
const { haversineKm } = require('../src/services/geoService');

function nearestDistrict(lat, lng) {
  let best = null;
  let bestDist = Infinity;
  for (const hq of NER_DISTRICT_HQ_APPROX) {
    const d = haversineKm(lat, lng, hq.lat, hq.lng);
    if (d < bestDist) {
      bestDist = d;
      best = hq;
    }
  }
  return best ? { ...best, distanceKm: Math.round(bestDist * 10) / 10 } : null;
}

async function run() {
  await connectDB();

  const roads = await Road.find({ source: { $ne: null }, lat: { $ne: null }, lng: { $ne: null } });
  console.log(`Found ${roads.length} real roads to process.`);

  let updated = 0;
  for (const road of roads) {
    const match = nearestDistrict(road.lat, road.lng);
    if (!match) continue;
    road.district = match.district;
    road.state = match.state;
    road.districtAssignmentMethod = 'NEAREST_DISTRICT_HQ_APPROXIMATION';
    await road.save();
    updated += 1;
  }

  console.log(`Updated ${updated} roads with approximate district assignment.`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
