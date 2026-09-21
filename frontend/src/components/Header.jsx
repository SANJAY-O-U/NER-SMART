/** Top command-center header with title, dashboard-active indicator, and refresh action. */
export default function Header({ onRefresh, refreshing, onResetDemo, resetting, resetError }) {
  return (
    <header className="bg-white text-slate-900 px-4 md:px-6 py-3.5 flex items-center justify-between border-b border-slate-200">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-brand-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
          NS
        </div>
        <div>
          <h1 className="text-lg md:text-xl font-bold tracking-wide leading-tight text-slate-900">NER SMART</h1>
          <p className="text-[11px] md:text-xs text-slate-500 leading-tight">
            North-East Essential Route Intelligence
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {resetError && (
          <span className="hidden md:inline text-[11px] text-red-600 max-w-[220px] truncate" title={resetError}>
            {resetError}
          </span>
        )}
        <span className="hidden sm:inline-flex items-center gap-1.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          DASHBOARD ACTIVE
        </span>
        {onResetDemo && (
          <button
            onClick={onResetDemo}
            disabled={resetting}
            title="Development/demo operation — wipes and reloads the known demo dataset (APP_MODE=demo only)"
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50 transition"
          >
            {resetting ? "Resetting…" : "RESET DEMO"}
          </button>
        )}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 transition"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </header>
  );
}
