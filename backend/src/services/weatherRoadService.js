/**
 * Weather-to-Road Association
 * ----------------------------
 * Finds the nearest weather observation to a road (using its lat/lng
 * midpoint) via the same $near geospatial pattern as geoService's
 * nearest-road lookup. Weather stations are far sparser than road
 * segments, so the confidence thresholds here are deliberately wider
 * than geoService's road-matching thresholds — and every result is
 * explicit that this is the NEAREST STATION's reading, not a
 * measurement taken on the road itself.
 */

const WeatherObservation = require('../models/WeatherObservation');

// Wider thresholds than road-matching (geoService.js) because weather
// stations are sparse; a "HIGH confidence" weather match can still be
// tens of kilometers away. Documented here, not derived from a
// validated statistical study.
const WEATHER_CONFIDENCE_THRESHOLDS_KM = {
  HIGH: 25,
  MEDIUM: 60,
  LOW: 120,
};

function confidenceForWeatherDistance(distanceKm) {
  if (distanceKm <= WEATHER_CONFIDENCE_THRESHOLDS_KM.HIGH) return 'HIGH';
  if (distanceKm <= WEATHER_CONFIDENCE_THRESHOLDS_KM.MEDIUM) return 'MEDIUM';
  if (distanceKm <= WEATHER_CONFIDENCE_THRESHOLDS_KM.LOW) return 'LOW';
  return 'NONE';
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Finds the nearest weather observation to a given point, within the LOW
 * confidence radius. Returns null if none found (including if the
 * WeatherObservation collection is empty, which — per Phase 2's actual
 * state — it always is, since no live IMD data has ever been written).
 */
async function findNearestWeather(lat, lng) {
  const maxDistanceMeters = WEATHER_CONFIDENCE_THRESHOLDS_KM.LOW * 1000;

  let matches;
  try {
    matches = await WeatherObservation.find({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: maxDistanceMeters,
        },
      },
    }).limit(1);
  } catch (err) {
    // No 2dsphere index yet, or no observations with location set.
    return null;
  }

  if (!matches.length) return null;

  const observation = matches[0];
  const [obsLng, obsLat] = observation.location.coordinates;
  const distanceKm = Math.round(haversineKm(lat, lng, obsLat, obsLng) * 10) / 10;

  return {
    observation,
    distanceKm,
    confidence: confidenceForWeatherDistance(distanceKm),
  };
}

/** Convenience wrapper: weather context for a Road document's midpoint. */
async function findWeatherForRoad(road) {
  if (road.lat === undefined || road.lat === null || road.lng === undefined || road.lng === null) {
    return null;
  }
  return findNearestWeather(road.lat, road.lng);
}

module.exports = {
  findNearestWeather,
  findWeatherForRoad,
  confidenceForWeatherDistance,
  WEATHER_CONFIDENCE_THRESHOLDS_KM,
};
