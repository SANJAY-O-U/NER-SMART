/**
 * Consistent panel wrapper used for every dashboard section. `id` makes the panel a target for the
 * sidebar's in-page navigation (scroll-mt clears the sticky header).
 */
export default function Card({ id, title, children, className = "", subtitle }) {
  return (
    <section
      id={id}
      className={`scroll-mt-28 bg-white border border-slate-200 rounded-lg shadow-panel p-4 ${className}`}
    >
      {title && (
        <div className="mb-3">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            {title}
          </h2>
          {subtitle && <p className="text-2xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
