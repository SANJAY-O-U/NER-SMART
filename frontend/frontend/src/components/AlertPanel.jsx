import StatusBadge from "./StatusBadge";

function timeAgo(timestamp) {
  if (!timestamp) return "";
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

/** Scrollable list of alerts, newest first, color-coded by severity. */
export default function AlertPanel({ alerts }) {
  const safeAlerts = Array.isArray(alerts) ? alerts : [];

  if (!safeAlerts.length) {
    return <p className="text-sm text-slate-500 py-4 text-center">No alerts right now.</p>;
  }

  const sorted = [...safeAlerts].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  return (
    <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
      {sorted.map((a) => (
        <li key={a.id} className="py-2.5 flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <StatusBadge status={a.severity} />
              <span className="text-xs text-slate-400">{a.type}</span>
            </div>
            <p className="text-sm text-slate-700 mt-1">{a.message}</p>
          </div>
          <span className="text-xs text-slate-400 whitespace-nowrap">{timeAgo(a.timestamp)}</span>
        </li>
      ))}
    </ul>
  );
}
