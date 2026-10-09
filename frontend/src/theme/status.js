/**
 * Presentation-only status vocabulary for the dashboard.
 *
 * This module maps values the backend ALREADY returns to a label, a text
 * glyph and a color. It never derives, computes or defaults a status: an
 * unrecognised or missing value maps to the neutral "unknown" entry, which
 * is deliberately NOT green, so absence of data never reads as "all clear".
 *
 * Two different concepts are kept apart on purpose (see KPISection.jsx):
 *   - accessibility.state : evidence-based engine output
 *       OPEN | RESTRICTED | HIGH_RISK | BLOCKED | UNKNOWN
 *   - road.status / road.physicalStatus : the stored (manual / imported)
 *       road status. It is NOT an accessibility verdict, so it keeps its
 *       raw wording instead of "Accessible".
 *
 * Each entry also has a text `glyph`, so state is never conveyed by color
 * alone.
 */

// Tailwind classes (all semantic tokens from tailwind.config.js) are written
// out in full so Tailwind's content scanner can see them.
const TONE = {
  ok: {
    badge: "bg-ok-50 text-ok-700 border-ok-200",
    panel: "bg-ok-50 border-ok-200",
    text: "text-ok-700",
    solid: "bg-ok-600 text-white",
    dot: "bg-ok-500",
    hex: "#10b981",
  },
  warn: {
    badge: "bg-warn-50 text-warn-700 border-warn-200",
    panel: "bg-warn-50 border-warn-200",
    text: "text-warn-700",
    solid: "bg-warn-500 text-white",
    dot: "bg-warn-500",
    hex: "#f59e0b",
  },
  disrupt: {
    badge: "bg-disrupt-50 text-disrupt-700 border-disrupt-200",
    panel: "bg-disrupt-50 border-disrupt-200",
    text: "text-disrupt-700",
    solid: "bg-disrupt-600 text-white",
    dot: "bg-disrupt-500",
    hex: "#f97316",
  },
  block: {
    badge: "bg-block-50 text-block-700 border-block-200",
    panel: "bg-block-50 border-block-200",
    text: "text-block-700",
    solid: "bg-block-600 text-white",
    dot: "bg-block-600",
    hex: "#dc2626",
  },
  neutral: {
    badge: "bg-neutral-100 text-neutral-600 border-neutral-300",
    panel: "bg-neutral-50 border-neutral-200",
    text: "text-neutral-600",
    solid: "bg-neutral-500 text-white",
    dot: "bg-neutral-400",
    hex: "#94a3b8",
  },
  info: {
    badge: "bg-primary-50 text-primary-700 border-primary-200",
    panel: "bg-primary-50 border-primary-200",
    text: "text-primary-700",
    solid: "bg-primary-600 text-white",
    dot: "bg-primary-500",
    hex: "#2563eb",
  },
};

// Left accent bar used by list rows (alerts, incidents). Written out in full for Tailwind's scanner.
const BAR = {
  ok: "border-l-ok-500",
  warn: "border-l-warn-500",
  disrupt: "border-l-disrupt-500",
  block: "border-l-block-600",
  neutral: "border-l-neutral-300",
  info: "border-l-primary-500",
};

export const tone = (name) => {
  const key = TONE[name] ? name : "neutral";
  return { ...TONE[key], bar: BAR[key] };
};

/* ---------------- Accessibility (engine) state ---------------- */

const ACCESSIBILITY = {
  OPEN: { label: "ACCESSIBLE", glyph: "✓", tone: "ok" },
  RESTRICTED: { label: "AT RISK", glyph: "!", tone: "warn" },
  HIGH_RISK: { label: "DISRUPTED", glyph: "▲", tone: "disrupt" },
  BLOCKED: { label: "BLOCKED", glyph: "✕", tone: "block" },
  UNKNOWN: { label: "UNKNOWN", glyph: "?", tone: "neutral" },
};

/** Display info for an accessibility.state value. `raw` keeps the engine code visible. */
export function accessibilityDisplay(state) {
  const key = (state ?? "").toString().toUpperCase();
  const entry = ACCESSIBILITY[key] || ACCESSIBILITY.UNKNOWN;
  return { ...entry, ...tone(entry.tone), raw: key || "UNKNOWN" };
}

/* ---------------- Stored road status (NOT an accessibility verdict) ---------------- */

const ROAD_STATUS = {
  OPEN: { glyph: "✓", tone: "ok" },
  RESTRICTED: { glyph: "!", tone: "warn" },
  RISKY: { glyph: "!", tone: "warn" },
  HIGH_RISK: { glyph: "▲", tone: "disrupt" },
  BLOCKED: { glyph: "✕", tone: "block" },
  UNKNOWN: { glyph: "?", tone: "neutral" },
};

/** Raw wording is preserved: a stored "OPEN" is shown as OPEN, not as ACCESSIBLE. */
export function roadStatusDisplay(status) {
  const key = (status ?? "").toString().toUpperCase();
  const entry = ROAD_STATUS[key] || ROAD_STATUS.UNKNOWN;
  return { ...entry, ...tone(entry.tone), label: key || "UNKNOWN" };
}

/* ---------------- Severity / priority / risk level ---------------- */

const SEVERITY = {
  CRITICAL: { glyph: "●●", tone: "block", rank: 4 },
  HIGH: { glyph: "●", tone: "block", rank: 3 },
  MEDIUM: { glyph: "●", tone: "warn", rank: 2 },
  LOW: { glyph: "○", tone: "info", rank: 1 },
};

/** Incident / alert severity. Unknown values are neutral, never "low". */
export function severityDisplay(severity) {
  const key = (severity ?? "").toString().toUpperCase();
  const entry = SEVERITY[key];
  if (!entry) return { glyph: "?", rank: 0, ...tone("neutral"), label: key || "UNKNOWN" };
  return { ...entry, ...tone(entry.tone), label: key };
}

/** Derived from a 0-100 risk score with the same 31 / 61 thresholds the app already uses. */
export function riskLevelDisplay(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return { label: "N/A", glyph: "?", ...tone("neutral") };
  if (n >= 61) return { label: "HIGH", glyph: "▲", ...tone("block") };
  if (n >= 31) return { label: "MEDIUM", glyph: "!", ...tone("warn") };
  return { label: "LOW", glyph: "✓", ...tone("ok") };
}

/* ---------------- Relative time (same wording the panels already use) ---------------- */

export function timeAgo(timestamp) {
  if (!timestamp) return "";
  const diffMs = Date.now() - new Date(timestamp).getTime();
  if (Number.isNaN(diffMs)) return "";
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}
