/**
 * Weather -> Risk Adapter
 * -----------------------
 * Converts a normalized WeatherObservation into the EXISTING risk
 * engine's input shape ({ rainfallScore, slopeScore, historicalRisk,
 * roadCondition }, see riskService.js). Does NOT replace or duplicate
 * the risk algorithm — riskService.calculateRisk() is still the only
 * place that turns those four scores into a risk level.
 *
 * Every score this adapter produces comes with an explanation entry
 * naming which weather factor contributed, its source, and confidence —
 * per the mission's explainability requirement. Only weather.rainfallMm
 * and weather.windSpeedKmph are used, because those are the only two
 * numeric fields IMD's documented endpoints actually provide that map
 * cleanly onto the existing risk engine's inputs; nothing is inferred
 * beyond what's present.
 */

/**
 * Simple documented mapping from rainfall (mm/24hr) to a 0-100 score.
 * Thresholds are IMD's own rainfall categories (see
 * https://mausam.imd.gov.in — "Rainfall Categories"), not invented:
 *   0mm            -> 0
 *   0.1-15.5mm     -> light rain
 *   15.6-64.4mm    -> moderate rain
 *   64.5-115.5mm   -> heavy rain
 *   115.6-204.4mm  -> very heavy rain
 *   >204.5mm       -> extremely heavy rain
 * Scaled onto 0-100 for the existing risk engine's `rainfallScore` input.
 */
function rainfallToScore(rainfallMm) {
  if (rainfallMm === null || rainfallMm === undefined) return null;
  if (rainfallMm <= 0) return 0;
  if (rainfallMm <= 15.5) return Math.round((rainfallMm / 15.5) * 20); // 0-20
  if (rainfallMm <= 64.4) return Math.round(20 + ((rainfallMm - 15.5) / (64.4 - 15.5)) * 30); // 20-50
  if (rainfallMm <= 115.5) return Math.round(50 + ((rainfallMm - 64.4) / (115.5 - 64.4)) * 25); // 50-75
  if (rainfallMm <= 204.4) return Math.round(75 + ((rainfallMm - 115.5) / (204.4 - 115.5)) * 15); // 75-90
  return Math.min(100, Math.round(90 + Math.min(10, (rainfallMm - 204.4) / 20))); // 90-100
}

/**
 * Wind is not a direct input to the existing risk engine (which only
 * takes rainfallScore/slopeScore/historicalRisk/roadCondition), so we
 * fold high wind into `roadCondition` degradation as a documented,
 * explicit choice — not silently ignored, not invented as a new engine
 * input the rest of the app doesn't know about.
 */
function windToRoadConditionPenalty(windSpeedKmph) {
  if (windSpeedKmph === null || windSpeedKmph === undefined) return 0;
  if (windSpeedKmph < 40) return 0;
  if (windSpeedKmph < 62) return 10; // IMD "moderate thunderstorm" gust threshold
  if (windSpeedKmph < 88) return 20; // "severe thunderstorm" gust threshold
  return 30; // "very severe thunderstorm" gust threshold
}

/**
 * @param {object} weather - a normalized WeatherObservation (or null)
 * @param {object} baseRoadFactors - existing road-level inputs the risk
 *   engine already uses (roadCondition baseline, etc.) — this adapter
 *   only adjusts what weather can actually inform.
 */
function extractRiskFeaturesFromWeather(weather, baseRoadFactors = {}) {
  const explanation = [];

  if (!weather) {
    return {
      riskInput: { ...baseRoadFactors },
      explanation: [
        {
          factor: 'weather',
          contribution: 0,
          source: null,
          observedAt: null,
          confidence: null,
          note: 'No weather observation available for this road — risk computed without weather input.',
        },
      ],
    };
  }

  const rainfallScore = rainfallToScore(weather.rainfallMm);
  const windPenalty = windToRoadConditionPenalty(weather.windSpeedKmph);

  const riskInput = { ...baseRoadFactors };
  if (rainfallScore !== null) {
    riskInput.rainfallScore = rainfallScore;
    explanation.push({
      factor: 'rainfall',
      contribution: rainfallScore,
      source: weather.source,
      observedAt: weather.observedAt,
      confidence: weather.confidence,
      rawValue: `${weather.rainfallMm}mm/24hr`,
    });
  }

  if (windPenalty > 0) {
    riskInput.roadCondition = Math.min(100, (baseRoadFactors.roadCondition || 0) + windPenalty);
    explanation.push({
      factor: 'wind',
      contribution: windPenalty,
      source: weather.source,
      observedAt: weather.observedAt,
      confidence: weather.confidence,
      rawValue: `${weather.windSpeedKmph}km/h`,
    });
  }

  if (weather.warningLevel && weather.warningLevel !== 'NO_WARNING') {
    explanation.push({
      factor: 'active_warning',
      contribution: null, // informational — does not directly modify a risk score input
      source: weather.source,
      observedAt: weather.observedAt,
      confidence: weather.confidence,
      rawValue: weather.warningLevel,
    });
  }

  return { riskInput, explanation };
}

module.exports = { extractRiskFeaturesFromWeather, rainfallToScore, windToRoadConditionPenalty };
