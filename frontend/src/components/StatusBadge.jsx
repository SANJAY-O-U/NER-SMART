import { tone, riskLevelDisplay } from "../theme/status";

/**
 * Small badges for statuses, priorities and risk. Every badge shows its meaning as TEXT (never color
 * alone). Colors come from the shared semantic palette in src/theme/status.js:
 *   ok = accessible/healthy · warn = at risk · disrupt = disrupted · block = blocked/critical/high
 *   info = in progress · neutral = unknown / not yet assessed (never implies "fine").
 * An unrecognised value renders neutral rather than being guessed.
 */

const KEY_TONE = {
  // severity / priority
  critical: "block",
  high: "block",
  medium: "warn",
  low: "info",
  high_priority: "disrupt",
  // road status (stored status, not an accessibility verdict)
  open: "ok",
  restricted: "warn",
  risky: "warn",
  at_risk: "warn",
  high_risk: "disrupt",
  blocked: "block",
  // shipment status
  in_transit: "info",
  pending: "neutral",
  delayed: "warn",
  rerouted: "disrupt",
  delivered: "ok",
  // incident workflow status
  reported: "neutral",
  ai_analysed: "info",
  verified: "info",
  action_required: "disrupt",
  resolved: "ok",
  // generic
  active: "ok",
  ok: "ok",
};

const BASE = "inline-flex items-center px-2 py-0.5 rounded-md text-2xs font-semibold border whitespace-nowrap";

/** Badge that renders a 0-100 risk score with LOW/MEDIUM/HIGH coloring. */
export function RiskBadge({ score = 0 }) {
  const level = riskLevelDisplay(score);
  return (
    <span className={`${BASE} gap-1 ${level.badge}`}>
      <span aria-hidden="true">{level.glyph}</span>
      {level.label} · {score}
    </span>
  );
}

/** Generic status/priority badge — pass any string, it will be tone-matched. */
export default function StatusBadge({ status }) {
  const key = (status ?? "").toString().toLowerCase().replace(/\s+/g, "_");
  const t = tone(KEY_TONE[key] || "neutral");
  return <span className={`${BASE} ${t.badge}`}>{status ?? "UNKNOWN"}</span>;
}
