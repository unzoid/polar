import { useRef, type ReactNode } from "react";

/**
 * An icon that animates when it changes (Plus → Check), but not when it first
 * appears or when its state first becomes known (data arriving after mount):
 * only a change from one known state to another plays. Keyed on `state`, so
 * each change mounts a fresh span and replays the CSS entrance.
 */
export function SwapIcon({ state, children }: { state: string | undefined; children: ReactNode }) {
  const prev = useRef(state);
  const animate = useRef(false);
  if (prev.current !== state) {
    animate.current = prev.current !== undefined;
    prev.current = state;
  }
  return (
    <span key={state} className="icon-swap" data-animate={animate.current}>
      {children}
    </span>
  );
}
