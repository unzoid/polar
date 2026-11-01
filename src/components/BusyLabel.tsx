import { useEffect, useState, type ReactNode } from "react";

/** How long work runs before the ring shows, so fast responses don't flash it. */
const SHOW_AFTER_MS = 150;

/**
 * A button's label that crossfades to a small ring while `busy`. Both sit in
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
      <span className="busy-ring" aria-hidden />
    </span>
  );
}

/** The ring on its own (e.g. over a profile tile while it opens). */
export const BusyRing = ({ size = 18 }: { size?: number }) => (
  <span className="busy-ring busy-ring-solo" style={{ width: size, height: size }} aria-hidden />
);
