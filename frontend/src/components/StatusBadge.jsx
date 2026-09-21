/**
 * Small color-coded badges used across the dashboard for statuses,
 * priorities, and risk severity. Centralizing the color map here keeps
 * status colors consistent everywhere they appear.
 */

const STYLES = {
  low: "bg-emerald-100 text-emerald-800 border-emerald-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  high: "bg-red-100 text-red-800 border-red-300",
  active: "bg-emerald-100 text-emerald-800 border-emerald-300",
  ok: "bg-emerald-100 text-emerald-800 border-emerald-300",
  blocked: "bg-red-100 text-red-800 border-red-300",
  delayed: "bg-amber-100 text-amber-800 border-amber-300",
  at_risk: "bg-amber-100 text-amber-800 border-amber-300",
  critical: "bg-red-100 text-red-800 border-red-300",
  high_priority: "bg-orange-100 text-orange-800 border-orange-300",
  in_transit: "bg-brand-100 text-brand-700 border-brand-300",
  pending: "bg-slate-100 text-slate-700 border-slate-300",
  delivered: "bg-emerald-100 text-emerald-800 border-emerald-300",
  default: "bg-slate-100 text-slate-700 border-slate-300",
};

function riskLevel(score) {
  if (score >= 61) return "high";
  if (score >= 31) return "medium";
  return "low";
}

/** Badge that renders a 0-100 risk score with LOW/MEDIUM/HIGH coloring. */
export function RiskBadge({ score = 0 }) {
  const level = riskLevel(score);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${STYLES[level]}`}
    >
      {level.toUpperCase()} · {score}
    </span>
  );
}

/** Generic status/priority badge — pass any string, it will be color-matched. */
export default function StatusBadge({ status }) {
  const key = (status ?? "").toString().toLowerCase().replace(/\s+/g, "_");
  const cls = STYLES[key] || STYLES.default;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {status ?? "UNKNOWN"}
    </span>
  );
}
