/**
 * Disaster Risk Adapter
 * ----------------------
 * Converts a normalized SACHET alert into a 0-100 disaster risk
 * contribution score, with a full explanation of every factor. This is
 * a DOCUMENTED HEURISTIC — weights below are engineering judgement
 * calls (ordered severity/urgency/certainty scales matching CAP 1.2's
 * own defined value sets), not a trained or validated model. Never call
 * this "ML" or claim an accuracy figure for it.
 *
 * A road being in an alert's district changes its DISASTER RISK
 * CONTRIBUTION and (optionally) its accessibilityScore. It does NOT, by
 * itself, change physicalStatus/officialStatus/fieldStatus — those stay
 * UNKNOWN unless something else (field report, official closure notice)
 * says otherwise. See accessibilityService.js.
 */

// CAP 1.2 defines these as ordered enumerations — the numeric weights
// here just linearize them 0-1 in their documented order, not an
// invented scale.
const SEVERITY_WEIGHT = { Extreme: 1.0, Severe: 0.75, Moderate: 0.5, Minor: 0.25, Unknown: 0.1 };
const URGENCY_WEIGHT = { Immediate: 1.0, Expected: 0.7, Future: 0.4, Past: 0.1, Unknown: 0.1 };
const CERTAINTY_WEIGHT = { Observed: 1.0, Likely: 0.75, Possible: 0.5, Unlikely: 0.2, Unknown: 0.1 };

// Configurable, documented combination weights (must sum to 1.0).
const COMBINE_WEIGHTS = { severity: 0.5, urgency: 0.3, certainty: 0.2 };

/**
 * @param {object} alert - normalized SACHET alert (severity/urgency/certainty/expires)
 * @param {Date} [now] - injectable for testing
 * @returns {{ score: number|null, explanation: object[] }}
 */
function computeDisasterRiskContribution(alert, now = new Date()) {
  if (!alert) {
    return { score: null, explanation: [{ factor: 'disaster_alert', contribution: null, note: 'no alert' }] };
  }

  // An expired alert contributes nothing — freshness gates relevance
  // before severity/urgency/certainty are even considered.
  if (alert.expires && new Date(alert.expires) < now) {
    return {
      score: 0,
      explanation: [
        {
          factor: 'expiry',
          contribution: 0,
          source: 'NDMA_SACHET',
          note: `Alert expired at ${new Date(alert.expires).toISOString()}`,
        },
      ],
    };
  }

  const severityWeight = SEVERITY_WEIGHT[alert.severity] ?? SEVERITY_WEIGHT.Unknown;
  const urgencyWeight = URGENCY_WEIGHT[alert.urgency] ?? URGENCY_WEIGHT.Unknown;
  const certaintyWeight = CERTAINTY_WEIGHT[alert.certainty] ?? CERTAINTY_WEIGHT.Unknown;

  const combined =
    severityWeight * COMBINE_WEIGHTS.severity +
    urgencyWeight * COMBINE_WEIGHTS.urgency +
    certaintyWeight * COMBINE_WEIGHTS.certainty;

  const score = Math.round(combined * 100);

  const explanation = [
    {
      factor: 'severity',
      contribution: Math.round(severityWeight * COMBINE_WEIGHTS.severity * 100),
      source: 'NDMA_SACHET',
      rawValue: alert.severity || 'Unknown',
    },
    {
      factor: 'urgency',
      contribution: Math.round(urgencyWeight * COMBINE_WEIGHTS.urgency * 100),
      source: 'NDMA_SACHET',
      rawValue: alert.urgency || 'Unknown',
    },
    {
      factor: 'certainty',
      contribution: Math.round(certaintyWeight * COMBINE_WEIGHTS.certainty * 100),
      source: 'NDMA_SACHET',
      rawValue: alert.certainty || 'Unknown',
    },
    {
      factor: 'event_type',
      contribution: null, // informational only — not scored separately, avoids double-counting with severity
      source: 'NDMA_SACHET',
      rawValue: alert.event || 'Unknown',
    },
  ];

  return { score, explanation };
}

module.exports = { computeDisasterRiskContribution, SEVERITY_WEIGHT, URGENCY_WEIGHT, CERTAINTY_WEIGHT, COMBINE_WEIGHTS };
