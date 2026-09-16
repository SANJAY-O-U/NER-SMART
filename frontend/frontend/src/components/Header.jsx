/** Top command-center header with title, live indicator, and refresh action. */
export default function Header({ onRefresh, refreshing }) {
  return (
    <header className="bg-[#0B3B4F] text-white px-4 md:px-6 py-4 flex items-center justify-between shadow-md">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-wide">NER-SMART</h1>
        <p className="text-xs md:text-sm text-teal-200/90">
          Logistics Intelligence Command Center
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline-flex items-center gap-1.5 text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 px-2.5 py-1 rounded-full">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          LIVE
        </span>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 disabled:opacity-50 transition"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </header>
  );
}
