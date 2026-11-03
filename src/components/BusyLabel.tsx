import { useEffect, useState, type ReactNode } from "react";
import { Spinner } from "./Spinner";

/** How long work runs before the spinner shows, so fast responses don't flash it. */
const SHOW_AFTER_MS = 150;

/**
 * A button's label that crossfades to a small spinner while `busy`. Both sit in
 * the same grid cell, so the button never changes size.
 */
export function BusyLabel({ busy, children }: { busy: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!busy) return setShown(false);
    const t = window.setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [busy]);
  return (
    <span className="busy-label" data-busy={shown}>
      <span className="busy-label-text">{children}</span>
      <Spinner className="busy-ring" size={18} />
    </span>
  );
}

/** The spinner on its own (e.g. over a profile tile while it opens). */
export const BusyRing = ({ size = 18 }: { size?: number }) => <Spinner className="busy-ring-solo" size={size} />;
