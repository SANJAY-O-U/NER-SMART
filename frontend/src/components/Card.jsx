/**
 * Consistent panel wrapper used for every dashboard section.
 *  - `id` makes the panel a target for the sidebar's in-page navigation (scroll-mt clears the sticky header).
 *  - `actions` is an optional node shown at the right of the header (counts, small controls).
 *  - `flush` removes body padding so a map or table can run edge-to-edge; the header stays padded.
 */
export default function Card({ id, title, children, className = "", subtitle, actions, flush = false }) {
  return (
    <section
      id={id}
      className={`scroll-mt-28 bg-white border border-slate-200 rounded-lg shadow-panel ${
        flush ? "flex flex-col overflow-hidden" : "p-4"
      } ${className}`}
    >
      {title && (
        <div
          className={`flex items-start justify-between gap-3 ${
            flush ? "px-4 pt-3 pb-2.5 border-b border-slate-100 shrink-0" : "mb-3"
          }`}
        >
          <div className="min-w-0">
            <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">{title}</h2>
            {subtitle && <p className="text-2xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      {flush ? <div className="flex-1 min-h-0">{children}</div> : children}
    </section>
  );
}
