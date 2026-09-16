/** Shared error state with an optional retry action. */
export default function ErrorMessage({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
      <p className="text-sm text-red-600 font-medium">
        {message || "Something went wrong."}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-red-600 text-white hover:bg-red-700 transition"
        >
          Retry
        </button>
      )}
    </div>
  );
}
