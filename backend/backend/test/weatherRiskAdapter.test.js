const test = require('node:test');
const assert = require('node:assert/strict');
const { extractRiskFeaturesFromWeather, rainfallToScore, windToRoadConditionPenalty } = require('../src/services/weatherRiskAdapter');
const { confidenceForWeatherDistance, WEATHER_CONFIDENCE_THRESHOLDS_KM } = require('../src/services/weatherRoadService');

test('rainfallToScore returns 0 for no rain', () => {
  assert.equal(rainfallToScore(0), 0);
});

test('rainfallToScore scales within the light-rain band', () => {
  const score = rainfallToScore(7.75); // half of 15.5
  assert.ok(score > 0 && score < 20, `expected 0-20, got ${score}`);
});

test('rainfallToScore approaches 100 for extremely heavy rain', () => {
  const score = rainfallToScore(300);
  assert.ok(score >= 90, `expected >=90, got ${score}`);
});

test('rainfallToScore returns null when rainfall is unknown (never fabricated)', () => {
  assert.equal(rainfallToScore(null), null);
  assert.equal(rainfallToScore(undefined), null);
});

test('windToRoadConditionPenalty is 0 below the light-thunderstorm gust threshold', () => {
  assert.equal(windToRoadConditionPenalty(20), 0);
});

test('windToRoadConditionPenalty escalates through documented IMD gust thresholds', () => {
  assert.equal(windToRoadConditionPenalty(45), 10);
  assert.equal(windToRoadConditionPenalty(70), 20);
  assert.equal(windToRoadConditionPenalty(95), 30);
});

test('extractRiskFeaturesFromWeather returns base factors and a no-weather explanation when weather is null', () => {
  const base = { rainfallScore: 20, slopeScore: 30, historicalRisk: 10, roadCondition: 15 };
  const { riskInput, explanation } = extractRiskFeaturesFromWeather(null, base);
  assert.deepEqual(riskInput, base);
  assert.equal(explanation.length, 1);
  assert.equal(explanation[0].factor, 'weather');
  assert.equal(explanation[0].source, null);
});

test('extractRiskFeaturesFromWeather overrides rainfallScore and explains it', () => {
  const weather = {
    source: 'IMD_CURRENT_WX',
    rainfallMm: 42.6,
    windSpeedKmph: 12,
    observedAt: new Date(),
    confidence: 0.9,
  };
  const base = { rainfallScore: 20, slopeScore: 30, historicalRisk: 10, roadCondition: 15 };
  const { riskInput, explanation } = extractRiskFeaturesFromWeather(weather, base);

  assert.notEqual(riskInput.rainfallScore, base.rainfallScore);
  assert.equal(riskInput.slopeScore, base.slopeScore); // untouched — weather doesn't inform slope

  const rainfallFactor = explanation.find((e) => e.factor === 'rainfall');
  assert.ok(rainfallFactor);
  assert.equal(rainfallFactor.source, 'IMD_CURRENT_WX');
  assert.equal(rainfallFactor.confidence, 0.9);
});

test('extractRiskFeaturesFromWeather adds a roadCondition wind penalty only above threshold', () => {
  const calmWeather = { source: 'IMD_AWS', rainfallMm: 0, windSpeedKmph: 10, observedAt: new Date() };
  const base = { rainfallScore: 0, slopeScore: 0, historicalRisk: 0, roadCondition: 25 };
  const { riskInput: calmResult } = extractRiskFeaturesFromWeather(calmWeather, base);
  assert.equal(calmResult.roadCondition, 25); // unchanged, wind below threshold

  const stormyWeather = { source: 'IMD_AWS', rainfallMm: 0, windSpeedKmph: 70, observedAt: new Date() };
  const { riskInput: stormyResult } = extractRiskFeaturesFromWeather(stormyWeather, base);
  assert.equal(stormyResult.roadCondition, 45); // 25 + 20 penalty
});

test('extractRiskFeaturesFromWeather surfaces an active warning as informational, not a score override', () => {
  const weather = {
    source: 'IMD_DISTRICT_WARNING',
    rainfallMm: null,
    windSpeedKmph: null,
    warningLevel: 'HEAVY_RAIN',
    observedAt: new Date(),
  };
  const { explanation } = extractRiskFeaturesFromWeather(weather, {});
  const warningFactor = explanation.find((e) => e.factor === 'active_warning');
  assert.ok(warningFactor);
  assert.equal(warningFactor.contribution, null);
  assert.equal(warningFactor.rawValue, 'HEAVY_RAIN');
});

test('confidenceForWeatherDistance uses the wider weather-specific thresholds', () => {
  assert.equal(confidenceForWeatherDistance(WEATHER_CONFIDENCE_THRESHOLDS_KM.HIGH), 'HIGH');
  assert.equal(confidenceForWeatherDistance(WEATHER_CONFIDENCE_THRESHOLDS_KM.HIGH + 1), 'MEDIUM');
  assert.equal(confidenceForWeatherDistance(WEATHER_CONFIDENCE_THRESHOLDS_KM.MEDIUM + 1), 'LOW');
  assert.equal(confidenceForWeatherDistance(WEATHER_CONFIDENCE_THRESHOLDS_KM.LOW + 1), 'NONE');
});
