/** Consistent panel wrapper used for every dashboard section. */
export default function Card({ title, children, className = "" }) {
  return (
    <section className={`bg-white border border-slate-200 rounded-lg shadow-sm p-4 ${className}`}>
      {title && (
        <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}
