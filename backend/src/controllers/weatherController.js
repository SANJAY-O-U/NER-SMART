const Road = require('../models/Road');
const { success, failure } = require('../utils/response');
const { findWeatherForRoad } = require('../services/weatherRoadService');
const { extractRiskFeaturesFromWeather } = require('../services/weatherRiskAdapter');
const { classifyFreshness } = require('../services/freshnessService');
const { hasCredentials } = require('../services/weatherService');
const { calculateRisk } = require('../services/riskService');

// GET /api/weather/road/:roadId
// Returns the nearest weather observation for a road (if any exists),
// its freshness classification, and the risk-engine features it would
// contribute — WITHOUT claiming weather was measured on the road itself.
async function getWeatherForRoad(req, res) {
  const road = await Road.findById(req.params.roadId);
  if (!road) return failure(res, 'Road not found', 404);

  const match = await findWeatherForRoad(road);

  if (!match) {
    const { riskInput, explanation } = extractRiskFeaturesFromWeather(null, {
      rainfallScore: road.floodRisk,
      slopeScore: road.landslideRisk,
      historicalRisk: 30,
      roadCondition: 25,
    });
    return success(res, {
      roadId: road.id,
      weather: null,
      freshness: 'UNAVAILABLE',
      reason: hasCredentials() ? 'no observation within range' : 'IMD credentials not configured — see IMD_INTEGRATION.md',
      riskInput,
      explanation,
    });
  }

  const observation = match.observation.toJSON ? match.observation.toJSON() : match.observation;
  const freshness = classifyFreshness({
    observedAt: observation.observedAt,
    receivedAt: observation.receivedAt,
    hasCredentials: hasCredentials(),
  });

  const { riskInput, explanation } = extractRiskFeaturesFromWeather(observation, {
    rainfallScore: road.floodRisk,
    slopeScore: road.landslideRisk,
    historicalRisk: 30,
    roadCondition: 25,
  });

  const risk = calculateRisk(riskInput);

  return success(res, {
    roadId: road.id,
    weather: observation,
    distanceToStationKm: match.distanceKm,
    matchConfidence: match.confidence,
    freshness,
    riskInput,
    riskResult: risk,
    explanation,
  });
}

module.exports = { getWeatherForRoad };
