const COLOR_MAP = {
  teal: "text-teal-700 bg-teal-50 border-teal-200",
  amber: "text-amber-700 bg-amber-50 border-amber-200",
  red: "text-red-700 bg-red-50 border-red-200",
  slate: "text-slate-700 bg-slate-50 border-slate-200",
};

/** Single KPI stat card. Reused by KPISection for all four dashboard metrics. */
export default function KPICard({ label, value, color = "slate", icon }) {
  const cls = COLOR_MAP[color] || COLOR_MAP.slate;
  return (
    <div className={`rounded-lg border px-4 py-3 flex items-center justify-between ${cls}`}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </div>
      {icon && <span className="text-2xl opacity-70" aria-hidden="true">{icon}</span>}
    </div>
  );
}
