import { tone } from "../theme/status";

/**
 * KPI presentation primitives. Both show a value the caller already computed from real fetched data;
 * neither derives, trends or defaults anything.
 *
 *  - CriticalKPI : a prominent tile for the P0 counts. `tone` is applied only when the count is above
 *    zero ("needs attention"); a zero stays neutral so it never reads as an all-clear.
 *  - CompactKPI  : a dense label/value row for supporting counts. Labels wrap instead of clipping.
 */

export function CriticalKPI({ label, value, hint, tone: toneName = "neutral", Icon, active }) {
  const t = tone(active ? toneName : "neutral");
  return (
    <div
      title={hint}
      className={`rounded-lg border border-l-4 px-4 py-3 flex flex-col justify-between min-h-[96px] ${t.panel} ${t.bar}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-700 leading-tight">{label}</p>
        {Icon && <Icon className={`h-5 w-5 shrink-0 ${active ? t.text : "text-slate-400"}`} />}
      </div>
      <div>
        <p className={`text-3xl font-bold leading-none ${active ? t.text : "text-slate-800"}`}>{value}</p>
        {hint && <p className="text-2xs text-slate-500 mt-1.5 leading-tight">{hint}</p>}
      </div>
    </div>
  );
}

export function CompactKPI({ label, value, hint, dot }) {
  const t = dot ? tone(dot) : null;
  return (
    <div title={hint} className="bg-white px-3.5 py-2.5 flex items-center justify-between gap-3 min-w-0">
      <dt className="text-xs text-slate-600 leading-tight">{label}</dt>
      <dd className="flex items-center gap-1.5 text-base font-semibold text-slate-900 leading-none shrink-0">
        {t && <span className={`h-2 w-2 rounded-full ${t.dot}`} aria-hidden="true" />}
        {value}
      </dd>
    </div>
  );
}

export default CompactKPI;
