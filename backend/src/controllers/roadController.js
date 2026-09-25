const Road = require('../models/Road');
const { success, failure } = require('../utils/response');
const { isValidEnumValue, sanitizeStringParam } = require('../utils/validators');

// GET /api/roads
// GET /api/roads?bbox=minLng,minLat,maxLng,maxLat
//
// Optional bbox param for viewport/corridor-based retrieval (Phase 1 —
// keeps the browser from ever having to load the whole road network at
// once as more corridors are imported). Without bbox, behavior is
// unchanged from the screening demo: return everything, sorted by name.
async function getRoads(req, res) {
  // Phase 1 hardening: reject a non-string bbox (e.g. from bracket-notation
  // query injection like `?bbox[$ne]=x`) before it ever reaches `.split`.
  const bbox = sanitizeStringParam(req.query.bbox);

  if (!bbox) {
    const roads = await Road.find().sort({ name: 1 });
    return success(res, roads);
  }

  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
    return failure(res, 'bbox must be "minLng,minLat,maxLng,maxLat"', 422);
  }
  const [minLng, minLat, maxLng, maxLat] = parts;

  // Roads with real geometry: proper geospatial intersection query.
  const geoRoads = await Road.find({
    geometry: {
      $geoIntersects: {
        $geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [minLng, minLat],
              [maxLng, minLat],
              [maxLng, maxLat],
              [minLng, maxLat],
              [minLng, minLat],
            ],
          ],
        },
      },
    },
  });

  // Legacy prototype roads (no geometry): simple lat/lng box filter so
  // they still show up on a bbox-filtered map.
  const pointRoads = await Road.find({
    geometry: { $exists: false },
    lat: { $gte: minLat, $lte: maxLat },
    lng: { $gte: minLng, $lte: maxLng },
  });

  return success(res, [...geoRoads, ...pointRoads].sort((a, b) => a.name.localeCompare(b.name)));
}

// PATCH /api/roads/:id
// Note: req.params.id is already confirmed a valid ObjectId by the
// validateObjectIdParam('id') route middleware before this runs.
async function updateRoad(req, res) {
  const allowedFields = [
    'name',
    'status',
    'lat',
    'lng',
    'floodRisk',
    'landslideRisk',
    'physicalStatus',
    'officialStatus',
    'fieldStatus',
    'lastVerifiedAt',
  ];
  const enumFields = ['status', 'physicalStatus', 'officialStatus', 'fieldStatus'];
  const updates = {};

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  for (const field of enumFields) {
    if (updates[field] !== undefined && !isValidEnumValue(Road, field, updates[field])) {
      return failure(res, `${field} must be one of ${Road.schema.path(field).enumValues.join(', ')}`, 422);
    }
  }

  const road = await Road.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!road) return failure(res, 'Road not found', 404);

  return success(res, road);
}

module.exports = { getRoads, updateRoad };
