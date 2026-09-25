/**
 * Disaster Alert Lifecycle Policy
 * --------------------------------
 * Phase 4: determines when a SACHET-derived DisasterAlert stops counting
 * as current operational evidence. Small, pure, documented policy module
 * — same shape as incidentFreshnessService.js — so it's independently
 * unit-testable without a live MongoDB connection (this project's
 * sandbox constraint throughout).
 *
 * CAP 1.2's `expires` field is optional. When present, it is always
 * authoritative and is respected exactly (never overridden). When a real
 * SACHET alert omits `expires` (legitimate under the spec), the alert
 * would otherwise stay lifecycleStatus=ACTIVE forever — silently
 * violating the project rule that an expired or unverifiable disaster
 * alert must not continue to present itself as current evidence.
 *
 * The fallback age threshold below REUSES the convention already
 * established for field incidents (see incidentFreshnessService's
 * STALE_AFTER_HOURS = 72) rather than inventing a new number — an
 * engineering default, not a CAP-defined or scientifically validated SLA.
 */

const DEFAULT_MAX_AGE_HOURS_WHEN_NO_EXPIRY = 72; // 3 days — same convention as incidentFreshnessService.STALE_AFTER_HOURS

/**
 * @param {object} alert - a DisasterAlert-shaped object (or a lean
 *   projection of one) with `expires`, `sent`, `firstSeenAt`.
 * @param {object} [options]
 * @param {Date} [options.now] - injectable for testing.
 * @param {number} [options.maxAgeHoursWhenNoExpiry] - injectable for testing.
 * @returns {boolean} true if this alert should no longer count as current
 *   operational evidence.
 */
function isAlertExpired(alert, { now = new Date(), maxAgeHoursWhenNoExpiry = DEFAULT_MAX_AGE_HOURS_WHEN_NO_EXPIRY } = {}) {
  if (alert.expires) {
    return new Date(alert.expires).getTime() < now.getTime();
  }

  // No CAP expiry provided — fall back to age since the alert was last
  // sent (or, if even that is unknown, since we first saw it). Never
  // treated as permanently current just because expires is absent.
  const reference = alert.sent || alert.firstSeenAt;
  if (!reference) return true; // no timestamp at all -> unverifiable, never presented as current

  const ageHours = (now.getTime() - new Date(reference).getTime()) / (1000 * 60 * 60);
  return ageHours > maxAgeHoursWhenNoExpiry;
}

module.exports = { isAlertExpired, DEFAULT_MAX_AGE_HOURS_WHEN_NO_EXPIRY };
