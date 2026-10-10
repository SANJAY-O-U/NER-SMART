/**
 * Road line styling that depends only on status and map zoom (Phase 10). Pure and dependency-free so it
 * can be unit-tested with `node --test` and shared by the road layer and the legend.
 *
 * Visibility on the OSM basemap comes from three things that do NOT change what a status means:
 *   1. a thin white casing under every road line (the line's contrast is then against white, not terrain),
 *   2. a darker neutral gray for UNKNOWN (theme/status.js) with a dashed stroke as the "unverified" cue,
 *   3. a line weight that grows with zoom, so the corridor is not hair-thin when zoomed out and does not
 *      swamp neighbouring segments when zoomed in.
 */

export const CASING_COLOR = "#ffffff";
/** The casing is this many pixels wider than the line it sits under (1.5px visible each side). */
export const CASING_EXTRA = 3;
/** Dash pattern for UNKNOWN / unverified roads. */
export const UNKNOWN_DASH = "8 6";

/** Base line weight in px for a map zoom level. Unknown zoom falls back to the previous fixed weight. */
export function baseRoadWeight(zoom) {
  // Only a real number is a zoom level (Number(null) would be 0, which is not "zoomed all the way out").
  if (typeof zoom !== "number" || !Number.isFinite(zoom)) return 3;
  if (zoom <= 6) return 2;
  if (zoom <= 8) return 3;
  if (zoom <= 10) return 4;
  return 5;
}

// Restrictive statuses stand out by weight as well as color, so status is not conveyed by color alone.
const STATUS_BOOST = { BLOCKED: 2, HIGH_RISK: 1 };

/** Line weight for an effective stored status at a zoom level. */
export function roadLineWeight(status, zoom) {
  return baseRoadWeight(zoom) + (STATUS_BOOST[status] || 0);
}

/** Casing weight for a given (final) line weight. */
export function roadCasingWeight(lineWeight) {
  return lineWeight + CASING_EXTRA;
}
