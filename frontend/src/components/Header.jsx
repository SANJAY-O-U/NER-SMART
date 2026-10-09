import { RefreshIcon } from "./icons";

/** Top command-center header: title, dashboard-active indicator, and the refresh / demo-reset actions. */
export default function Header({ onRefresh, refreshing, onResetDemo, resetting, resetError }) {
  return (
    <>
    <header className="bg-white border-b border-slate-200 px-3 md:px-6 h-14 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {/* On md+ the logo lives in the sidebar; on mobile it is shown here. */}
        <div className="md:hidden h-8 w-8 rounded-md bg-brand-500 flex items-center justify-center text-white font-bold text-xs shrink-0">
          NS
        </div>
        <div className="min-w-0">
          <h1 className="text-base md:text-lg font-bold leading-tight text-slate-900 truncate">
            <span className="md:hidden">NER SMART</span>
            <span className="hidden md:inline">Regional Command Center</span>
          </h1>
          <p className="hidden md:block text-xs text-slate-500 leading-tight truncate">
            NER SMART · North-East Essential Route Intelligence
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <span className="hidden sm:inline-flex items-center gap-1.5 text-xs bg-ok-50 text-ok-700 border border-ok-200 px-2.5 py-1 rounded-md font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-ok-500" aria-hidden="true" />
          DASHBOARD ACTIVE
        </span>
        {onResetDemo && (
          <button
            type="button"
            onClick={onResetDemo}
            disabled={resetting}
            title="Development/demo operation — wipes and reloads the known demo dataset (APP_MODE=demo only)"
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-white text-block-700 border border-block-200 hover:bg-block-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {resetting ? "Resetting…" : "RESET DEMO"}
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          <RefreshIcon className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </header>
    {/* Shown at every width (it used to be hidden below lg, which silently dropped the error). */}
    {resetError && (
      <p role="alert" className="bg-block-50 border-b border-block-200 px-3 md:px-6 py-1.5 text-xs font-medium text-block-700 break-words">
        {resetError}
      </p>
    )}
    </>
  );
}
