const STATUS_STYLE = {
  LIVE: "bg-emerald-100 text-emerald-700",
  CACHED: "bg-sky-100 text-sky-700",
  STALE: "bg-amber-100 text-amber-700",
  UNAVAILABLE: "bg-slate-200 text-slate-600",
  DEMO: "bg-purple-100 text-purple-700",
};

function timeAgo(timestamp) {
  if (!timestamp) return null;
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

/**
 * DataSourceStatus
 * Small, honest status list for each external data source the platform
 * depends on. Never shows LIVE unless the backend says so — this
 * component just renders whatever /api/datasources reports.
 */
export default function DataSourceStatus({ sources }) {
  const safeSources = Array.isArray(sources) ? sources : [];

  if (!safeSources.length) {
    return <p className="text-sm text-slate-500 py-2 text-center">No data sources registered yet.</p>;
  }

  return (
    <ul className="divide-y divide-slate-100">
      {safeSources.map((s) => (
        <li key={s.name} className="py-2 space-y-0.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">{s.name.replace(/_/g, " ")}</span>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${STATUS_STYLE[s.status] || STATUS_STYLE.UNAVAILABLE}`}>
              {s.status}
            </span>
          </div>
          {s.coverage && <p className="text-xs text-slate-500">{s.coverage}</p>}
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>{s.source}</span>
            {timeAgo(s.lastUpdated) && <span>{timeAgo(s.lastUpdated)}</span>}
          </div>
          {s.error && <p className="text-[11px] text-amber-600 mt-0.5">{s.error}</p>}
        </li>
      ))}
    </ul>
  );
}
