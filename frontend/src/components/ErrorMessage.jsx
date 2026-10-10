/** Shared error state with an optional retry action. */
export default function ErrorMessage({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
      <p className="text-sm text-block-700 font-medium">
        {message || "Something went wrong."}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-block-600 text-white hover:bg-block-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-block-700 focus-visible:ring-offset-2"
        >
          Retry
        </button>
      )}
    </div>
  );
}
