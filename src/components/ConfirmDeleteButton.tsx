import { useEffect, useState, type ButtonHTMLAttributes } from "react";
import { IconButton } from "./ui/Button";

/** How long the armed state waits for the second click before standing down. */
const DISARM_AFTER = 3000;

/**
 * The two-step behaviour on any button: `onClick` arms it, a second click runs `onConfirm`. It stands
 * down on its own after a few seconds, on Escape, or when focus moves away. Spread `props` on the button
 * and give it the `confirm-delete` class (red while armed, the bin's lid open).
 */
export function useConfirmDelete(onConfirm: () => void) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), DISARM_AFTER);
    return () => window.clearTimeout(t);
  }, [armed]);

  const props: ButtonHTMLAttributes<HTMLButtonElement> & { "data-armed"?: true } = {
    "data-armed": armed || undefined,
    onClick: () => (armed ? onConfirm() : setArmed(true)),
    onBlur: () => setArmed(false),
    onKeyDown: (e) => {
      if (e.key === "Escape" && armed) {
        e.stopPropagation();
        setArmed(false);
      }
    },
  };
  return { armed, props };
}

/**
 * A two-step delete with no extra text: the first click arms it (the button
 * turns red and the bin's lid pops open), the second deletes.
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
  const { armed, props } = useConfirmDelete(onConfirm);
  return (
    <IconButton
      className={className ? `confirm-delete quiet-btn ${className}` : "confirm-delete quiet-btn"}
      label={armed ? `Click again to delete ${label}` : `Delete ${label}`}
      title={armed ? "Click again to delete" : `Delete ${label}`}
      {...props}
    >
      <TrashLid />
    </IconButton>
  );
}

/** A bin drawn in two parts so the lid can hinge open. */
export function TrashLid({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden className="confirm-delete-icon">
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
