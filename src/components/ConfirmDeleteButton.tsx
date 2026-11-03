import { useEffect, useState } from "react";

/** How long the armed state waits for the second click before standing down. */
const DISARM_AFTER = 3000;

/**
 * A two-step delete with no extra text: the first click arms it (the button
 * turns red and the bin's lid pops open), the second deletes. It stands down
 * on its own after a few seconds, on Escape, or when focus moves away.
 */
export function ConfirmDeleteButton({
  label,
  onConfirm,
  className = "",
}: {
  /** What gets deleted, e.g. "playlist". */
  label: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), DISARM_AFTER);
    return () => window.clearTimeout(t);
  }, [armed]);

  return (
    <button
      className={`btn btn-icon confirm-delete ${className}`}
      data-armed={armed || undefined}
      aria-label={armed ? `Click again to delete ${label}` : `Delete ${label}`}
      title={armed ? "Click again to delete" : `Delete ${label}`}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      onBlur={() => setArmed(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && armed) {
          e.stopPropagation();
          setArmed(false);
        }
      }}
    >
      <TrashLid />
    </button>
  );
}

/** A bin drawn in two parts so the lid can hinge open. */
function TrashLid() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden className="confirm-delete-icon">
      <g className="confirm-delete-lid">
        <path
          d="M7.5 4.75v-1c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25v1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <rect x="2.75" y="4.5" width="14.5" height="1.75" rx="0.875" />
      </g>
      <path
        fillRule="evenodd"
        d="M4.6 7.5h10.8l-.78 8.66A2 2 0 0 1 12.63 18H7.37a2 2 0 0 1-1.99-1.84L4.6 7.5ZM8 10.25a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 .75-.75Zm4 0a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 .75-.75Z"
      />
    </svg>
  );
}
