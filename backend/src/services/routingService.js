/**
 * Routing Service
 * ---------------
 * Provides route recommendations. In this Level-2 MVP there is no live
 * external routing API wired in — everything runs off local demo/fallback
 * route data, which the engineering rules mark as mandatory anyway (in case
 * a real routing API is flaky during the demo).
 *
 * Controllers must call into this service rather than hardcoding route
 * logic themselves.
 */

const { calculateRisk } = require('./riskService');

/**
 * Demo route catalogue: origin|destination -> candidate routes.
 * Each candidate route can be linked to a "roadName" so the landslide
 * simulation can figure out which routes are affected when a road is blocked.
 */
const DEMO_ROUTES = {
  'guwahati|imphal': [
    {
      name: 'Route A',
      roadName: 'NH-2 Guwahati-Imphal Highway',
      distance: 465,
      etaMinutes: 585,
      baseRisk: { rainfallScore: 55, slopeScore: 60, historicalRisk: 50, roadCondition: 40 },
      reason: 'Fastest route, higher landslide-prone terrain',
    },
    {
      name: 'Route B',
      roadName: 'NH-37 Alternate Corridor',
      distance: 430,
      etaMinutes: 620,
      baseRisk: { rainfallScore: 20, slopeScore: 25, historicalRisk: 15, roadCondition: 15 },
      reason: 'Lower landslide risk',
    },
  ],
};

function normalizeKey(origin, destination) {
  return `${String(origin).trim().toLowerCase()}|${String(destination).trim().toLowerCase()}`;
}

function formatEta(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

/**
 * Builds a generic fallback route pair when origin/destination isn't in the
 * demo catalogue, so the endpoint never returns empty-handed during a demo.
 */
function buildFallbackRoutes(origin, destination) {
  return [
    {
      name: 'Route A',
      roadName: `${origin}-${destination} Direct Road`,
      distance: 300,
      etaMinutes: 420,
      baseRisk: { rainfallScore: 45, slopeScore: 40, historicalRisk: 35, roadCondition: 30 },
      reason: 'Direct route',
    },
    {
      name: 'Route B',
      roadName: `${origin}-${destination} Bypass Road`,
      distance: 340,
      etaMinutes: 460,
      baseRisk: { rainfallScore: 20, slopeScore: 20, historicalRisk: 15, roadCondition: 15 },
      reason: 'Longer but safer bypass',
    },
  ];
}

function getCandidateRoutes(origin, destination) {
  const key = normalizeKey(origin, destination);
  return DEMO_ROUTES[key] || buildFallbackRoutes(origin, destination);
}

/**
 * Picks the best route for a given origin/destination/priority.
 * CRITICAL priority shipments always weight risk avoidance highest.
 *
 * @param {object} options
 * @param {string} options.origin
 * @param {string} options.destination
 * @param {string} [options.shipmentPriority]
 * @param {string[]} [options.excludeRoadNames] - roads currently blocked; routes using them are deprioritized
 */
function recommendRoute({ origin, destination, shipmentPriority = 'MEDIUM', excludeRoadNames = [] }) {
  const candidates = getCandidateRoutes(origin, destination).map((route) => {
    const { risk } = calculateRisk(route.baseRisk);
    const blocked = excludeRoadNames.includes(route.roadName);
    return { ...route, risk, blocked };
  });

  const usable = candidates.filter((c) => !c.blocked);
  const pool = usable.length > 0 ? usable : candidates;

  const isCritical = shipmentPriority === 'CRITICAL' || shipmentPriority === 'HIGH';

  const best = pool.reduce((chosen, current) => {
    if (!chosen) return current;
    if (isCritical) {
      return current.risk < chosen.risk ? current : chosen;
    }
    // Non-critical shipments favor shorter distance, tie-broken by risk.
    if (current.distance < chosen.distance) return current;
    if (current.distance === chosen.distance && current.risk < chosen.risk) return current;
    return chosen;
  }, null);

  const alternatives = pool.filter((c) => c.name !== best.name);
  const delayMinutes = alternatives.length > 0 ? Math.max(0, best.etaMinutes - alternatives[0].etaMinutes) : 0;

  return {
    recommendedRoute: best.name,
    distance: best.distance,
    eta: formatEta(best.etaMinutes),
    risk: best.risk,
    delay: delayMinutes > 0 ? `${delayMinutes} min` : '0 min',
    reason: best.reason,
    roadName: best.roadName,
  };
}

module.exports = { recommendRoute, getCandidateRoutes, normalizeKey };
