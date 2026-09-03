/** Shared loading indicator for full-page and in-card loading states. */
export default function LoadingSpinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-slate-500">
      <span className="h-4 w-4 rounded-full border-2 border-slate-300 border-t-teal-600 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
