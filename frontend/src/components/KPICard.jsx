const COLOR_MAP = {
  brand: "text-brand-700 bg-brand-50 border-brand-200",
  amber: "text-amber-700 bg-amber-50 border-amber-200",
  red: "text-red-700 bg-red-50 border-red-200",
  slate: "text-slate-700 bg-slate-50 border-slate-200",
  emerald: "text-emerald-700 bg-emerald-50 border-emerald-200",
};

/** Single KPI stat card. Reused by KPISection for all dashboard metrics. */
export default function KPICard({ label, value, color = "slate", icon }) {
  const cls = COLOR_MAP[color] || COLOR_MAP.slate;
  return (
    <div className={`rounded-lg border px-4 py-3.5 flex items-center justify-between ${cls}`}>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80 truncate">{label}</p>
        <p className="text-2xl font-bold mt-1 leading-none">{value}</p>
      </div>
      {icon && <span className="text-2xl opacity-70 shrink-0 ml-2" aria-hidden="true">{icon}</span>}
    </div>
  );
}
