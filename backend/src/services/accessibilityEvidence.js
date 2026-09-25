/**
 * Accessibility Evidence Builders
 * --------------------------------
 * Pure functions that normalize data from each existing source (Phase 1
 * Road status fields, Phase 2 weather, Phase 3B SACHET alerts, Phase 4A
 * GPS-associated incidents) into a single uniform evidence-item shape
 * for the accessibility engine. No I/O, no DB — callers (accessibilityService.js)
 * fetch the raw data; these functions only normalize it.
 *
 * Evidence item shape:
 * {
 *   source: 'ROAD_STATUS' | 'NDMA_SACHET' | <weather observation's own source, e.g. 'WEATHERAPI_CURRENT'/'IMD_AWS'> | 'FIELD_INCIDENT',
 *   type: string,                          // e.g. 'PHYSICAL_STATUS', 'FLOOD_ALERT'
 *   status: 'OPEN'|'RESTRICTED'|'HIGH_RISK'|'BLOCKED'|'UNKNOWN'|null,
 *   riskContribution: number|null,         // 0-100, for score-only evidence
 *   timestamp: Date|null,
 *   freshness: 'LIVE'|'STALE'|'CACHED'|'UNAVAILABLE'|null,
 *   confidence: 'HIGH'|'MEDIUM'|'LOW'|null,
 *   associationMethod: string|null,
 *   detail: string,                        // human-readable, used in explanations
 * }
 */

/**
 * Road.physicalStatus / officialStatus / fieldStatus — Phase 1's own
 * status trio. Each defaults to UNKNOWN (never inferred by Phase 1), so
 * this only produces "meaningful" evidence when a status was actually
 * set (e.g. via PATCH /api/roads/:id).
 */
function buildRoadStatusEvidence(road) {
  if (!road) return [];
  const items = [];
  const ts = road.lastVerifiedAt || null; // Phase 1 only tracks one shared verification timestamp

  const fields = [
    { key: 'physicalStatus', type: 'PHYSICAL_STATUS' },
    { key: 'officialStatus', type: 'OFFICIAL_STATUS' },
    { key: 'fieldStatus', type: 'FIELD_STATUS' },
  ];

  for (const f of fields) {
    const status = road[f.key];
    if (!status || status === 'UNKNOWN') continue; // absent evidence stays absent, never fabricated
    items.push({
      source: 'ROAD_STATUS',
      type: f.type,
      status,
      riskContribution: null,
      timestamp: ts,
      freshness: ts ? 'CACHED' : null, // never LIVE — we don't know how it was verified
      confidence: 'HIGH', // explicit status evidence is authoritative by design (see section 3)
      associationMethod: null,
      detail: `${f.type.replace('_', ' ').toLowerCase()} is ${status}`,
    });
  }

  return items;
}

/**
 * One evidence item per active SACHET alert already associated with
 * this road (Phase 3B's district-level association — reused, not
 * rebuilt). riskContribution is recomputed live (not read from the
 * stored, possibly-stale field) so an alert that expired since the last
 * ingestion pass correctly stops contributing immediately.
 */
function buildDisasterEvidence(alerts, computeDisasterRiskContribution, now = new Date()) {
  if (!alerts || !alerts.length) return [];

  return alerts
    .map((alert) => {
      const { score } = computeDisasterRiskContribution(alert, now);
      if (score === null || score === 0) return null; // expired or unscoreable — no evidence
      return {
        source: 'NDMA_SACHET',
        type: alert.event ? `${alert.event}`.toUpperCase().replace(/\s+/g, '_') : 'DISASTER_ALERT',
        status: null,
        riskContribution: score,
        timestamp: alert.sent || null,
        freshness: alert.lifecycleStatus === 'ACTIVE' || alert.lifecycleStatus === 'UPDATED' ? 'LIVE' : 'STALE',
        confidence: alert.associationConfidence || null,
        associationMethod: alert.associationMethod || null,
        detail: `${alert.severity || 'Unknown'} severity ${alert.event || 'alert'} (${alert.associationMethod || 'district association'})`,
      };
    })
    .filter(Boolean);
}

/**
 * Weather evidence via weatherRoadService, provider-agnostic (see
 * WEATHER_PROVIDER.md — the active provider is whichever one actually
 * wrote the matched WeatherObservation, e.g. 'WEATHERAPI_CURRENT' or
 * 'IMD_AWS'/'IMD_CURRENT_WX'). `source` is always taken from the real
 * persisted observation, never assumed — never fabricates a weather risk
 * when data is absent.
 *
 * Freshness is classified dynamically from the observation's own age
 * (via the injected `classifyFreshness`, same function/rules
 * `GET /api/weather/road/:roadId` already uses) — NOT read from the
 * stored `sourceStatus` field, which only ever records "the fetch that
 * wrote this row succeeded" and is frozen to 'LIVE' at persist time (see
 * weatherController.js's persistObservation). Using `sourceStatus`
 * directly would make a weather reading from hours/days ago masquerade
 * as current evidence forever. When `classifyFreshness` isn't injected,
 * falls back to the old `sourceStatus`-based value for backward
 * compatibility with callers that don't supply one.
 */
function buildWeatherEvidence(weatherMatch, extractRiskFeaturesFromWeather, { now = new Date(), classifyFreshness } = {}) {
  if (!weatherMatch || !weatherMatch.observation) return [];

  const weather = weatherMatch.observation;
  const { explanation } = extractRiskFeaturesFromWeather(weather, {});
  const rainfallFactor = explanation.find((e) => e.factor === 'rainfall');
  if (!rainfallFactor || rainfallFactor.contribution === null) return [];

  const freshness = classifyFreshness
    ? classifyFreshness({ observedAt: weather.observedAt, receivedAt: weather.receivedAt, now })
    : weather.sourceStatus || null;

  return [
    {
      source: weather.source,
      type: 'RAINFALL_EXPOSURE',
      status: null,
      riskContribution: rainfallFactor.contribution,
      timestamp: weather.observedAt || null,
      freshness,
      confidence: weatherMatch.confidence || null,
      associationMethod: null,
      detail: `Rainfall exposure from nearest weather source (${weatherMatch.distanceKm}km away)`,
    },
  ];
}

/**
 * Field/GPS incident evidence (Phase 4A). Only ACTIVE (non-resolved)
 * incidents contribute — a resolved incident is historical, not current
 * evidence of risk. `roadMatchConfidence` (how confidently the GPS point
 * was associated with this road) caps the evidence's own confidence —
 * per the mission's explicit instruction that low GPS/road-match
 * confidence must reduce evidence confidence, not be ignored.
 */
const SEVERITY_TO_RISK = { LOW: 20, MEDIUM: 45, HIGH: 75 };

function buildIncidentEvidence(incidents, { now = new Date(), classifyIncidentFreshness } = {}) {
  if (!incidents || !incidents.length) return [];

  return incidents
    .filter((inc) => inc.status !== 'RESOLVED')
    .map((inc) => {
      const risk = SEVERITY_TO_RISK[inc.severity] ?? SEVERITY_TO_RISK.MEDIUM;
      // Cap confidence at the GPS/road-match confidence — a HIGH-severity
      // report matched to this road with LOW confidence is weak evidence.
      const matchConfidence = inc.roadMatchConfidence;
      const confidence = matchConfidence === 'LOW' ? 'LOW' : matchConfidence === 'MEDIUM' ? 'MEDIUM' : 'HIGH';

      // Phase 6D: freshness now reflects real incident age, not an
      // unconditional 'LIVE' — an old unresolved incident is excluded
      // from the accessibility engine's active-evidence cascade (see
      // accessibilityEngine.js's isStale()) without ever being deleted.
      const freshness = classifyIncidentFreshness ? classifyIncidentFreshness(inc, { now }) : 'LIVE';

      return {
        source: 'FIELD_INCIDENT',
        type: inc.type || 'FIELD_REPORT',
        status: null,
        riskContribution: risk,
        timestamp: inc.timestamp || inc.createdAt || null,
        freshness,
        confidence,
        associationMethod: inc.associationMethod || null,
        detail: `${inc.severity || 'Unknown'} severity ${inc.type || 'incident'} reported (road match: ${matchConfidence || 'unknown'})`,
      };
    });
}

module.exports = {
  buildRoadStatusEvidence,
  buildDisasterEvidence,
  buildWeatherEvidence,
  buildIncidentEvidence,
  SEVERITY_TO_RISK,
};
