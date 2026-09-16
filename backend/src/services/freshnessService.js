/**
 * Freshness classification — pure, unit-tested, no I/O.
 *
 * "LIVE" must mean the data is within a configured freshness window, not
 * merely that a request once succeeded. This module is the single place
 * that decides LIVE vs STALE vs CACHED vs UNAVAILABLE so that rule is
 * enforced consistently everywhere freshness matters.
 */

// Configurable here, documented in IMD_INTEGRATION.md. IMD's current
// weather / AWS data is hourly-ish; these are engineering judgement
// calls, not derived from an IMD-published SLA (none was found in the
// public documentation).
const FRESHNESS_WINDOWS_MINUTES = {
  LIVE: 90, // within 90 minutes of observation -> LIVE
  CACHED: 24 * 60, // within 24 hours -> CACHED (usable but not current)
  // beyond CACHED window -> STALE (if we have data at all)
};

/**
 * @param {Date|null} observedAt - when the reading was actually taken (preferred)
 * @param {Date|null} receivedAt - when we fetched it, used if observedAt is unknown
 * @param {Date} now - injectable for testing; defaults to current time
 * @param {boolean} hasCredentials - if false, always returns UNAVAILABLE
 *   regardless of any cached data's age, because we have no way to even
 *   attempt a fresh fetch (this is our actual Phase 2 state).
 */
function classifyFreshness({ observedAt, receivedAt, now = new Date(), hasCredentials = true }) {
  if (!hasCredentials) return 'UNAVAILABLE';

  const reference = observedAt || receivedAt;
  if (!reference) return 'UNAVAILABLE';

  const ageMinutes = (now.getTime() - new Date(reference).getTime()) / 60000;
  if (ageMinutes < 0) return 'UNAVAILABLE'; // clock skew / bad data — don't claim freshness we can't justify

  if (ageMinutes <= FRESHNESS_WINDOWS_MINUTES.LIVE) return 'LIVE';
  if (ageMinutes <= FRESHNESS_WINDOWS_MINUTES.CACHED) return 'CACHED';
  return 'STALE';
}

module.exports = { classifyFreshness, FRESHNESS_WINDOWS_MINUTES };
