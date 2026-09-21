/** Consistent panel wrapper used for every dashboard section. */
export default function Card({ title, children, className = "", subtitle }) {
  return (
    <section className={`bg-white border border-slate-200 rounded-xl shadow-sm p-4 md:p-5 ${className}`}>
      {title && (
        <div className="mb-3">
          <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
            {title}
          </h2>
          {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
