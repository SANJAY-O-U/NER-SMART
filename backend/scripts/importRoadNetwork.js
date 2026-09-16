/**
 * importRoadNetwork.js
 * --------------------
 * Reusable, duplicate-safe importer that loads a GeoJSON FeatureCollection
 * of road LineStrings into the Road collection.
 *
 * Usage:
 *   node scripts/importRoadNetwork.js <path-to-geojson> [--corridor="Guwahati-Imphal"] [--source="..."]
 *
 * Example (the Phase 1 corridor dataset):
 *   node scripts/importRoadNetwork.js data/sources/nh_guwahati_imphal_corridor.geojson \
 *     --corridor="Guwahati-Imphal" \
 *     --source="datta07/INDIAN-SHAPEFILES (MIT) — INDIA_NATIONAL_HIGHWAY.geojson"
 *
 * Duplicate-safety: each feature is upserted keyed on (source, sourceId),
 * where sourceId is the feature's own OBJECTID (or `id`, or its array
 * index as a last resort). Re-running the script against the same file
 * updates existing documents in place rather than creating duplicates.
 *
 * This script does NOT touch any other collection and does NOT depend on
 * APP_MODE — imported real road data is intentionally available in both
 * demo and production modes.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../src/config/db');
const Road = require('../src/models/Road');
const { validateRoadFeature, geometryMidpoint } = require('../src/services/geoValidation');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    const match = arg.match(/^--([a-zA-Z0-9_]+)=(.*)$/);
    if (match) {
      flags[match[1]] = match[2];
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function run() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const filePath = positional[0];

  if (!filePath) {
    console.error('Usage: node scripts/importRoadNetwork.js <path-to-geojson> [--corridor=NAME] [--source=NAME]');
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const corridor = flags.corridor || null;
  const source = flags.source || 'unspecified source (pass --source=)';
  const sourceVintage = flags.vintage || null;

  console.log(`Reading ${absolutePath}...`);
  const raw = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));

  if (!raw || raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
    console.error('Input is not a valid GeoJSON FeatureCollection.');
    process.exit(1);
  }

  console.log(`Found ${raw.features.length} features. Validating...`);

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  await connectDB();

  for (let i = 0; i < raw.features.length; i += 1) {
    const feature = raw.features[i];
    const result = validateRoadFeature(feature);

    if (!result.valid) {
      skipped += 1;
      errors.push({ index: i, reason: result.reason });
      continue;
    }

    try {
      const props = feature.properties || {};
      const name = props.Name.trim();
      const sourceId = String(props.OBJECTID ?? feature.id ?? `idx-${i}`);
      const midpoint = geometryMidpoint(feature.geometry);

      const update = {
        name,
        lat: midpoint.lat,
        lng: midpoint.lng,
        geometry: {
          type: feature.geometry.type,
          coordinates: feature.geometry.coordinates,
        },
        roadNumber: name, // source names roads by their highway number, e.g. "NH 27"
        highwayClass: props.Road_Type || null,
        corridor,
        source,
        sourceId,
        sourceVintage,
        importedAt: new Date(),
        physicalStatus: 'UNKNOWN',
        officialStatus: 'UNKNOWN',
        fieldStatus: 'UNKNOWN',
        geometryConfidence: 0.8, // community-compiled dataset, not an official government feed — see DATA_PROVENANCE.md
        sourceProperties: props,
      };

      const existing = await Road.findOne({ source, sourceId });
      await Road.findOneAndUpdate(
        { source, sourceId },
        { $set: update, $setOnInsert: { status: 'OPEN', floodRisk: 0, landslideRisk: 0 } },
        { upsert: true, runValidators: true }
      );

      if (existing) updated += 1;
      else imported += 1;
    } catch (err) {
      skipped += 1;
      errors.push({ index: i, reason: err.message });
    }
  }

  console.log('\n--- Import summary ---');
  console.log(`Imported (new): ${imported}`);
  console.log(`Updated (existing): ${updated}`);
  console.log(`Skipped (invalid): ${skipped}`);
  if (errors.length > 0) {
    console.log(`\nFirst ${Math.min(5, errors.length)} errors:`);
    errors.slice(0, 5).forEach((e) => console.log(`  [${e.index}] ${e.reason}`));
  }

  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
