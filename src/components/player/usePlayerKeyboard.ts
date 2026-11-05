import { useEffect, useRef } from "react";
import { actionFor, type Action } from "../../lib/settings";

/**
 * The player's keyboard: shortcuts as bound in Settings → Controls, and Esc,
 * which always backs out. `onAction` returns whether it handled the key; it
 * may change every render (the listener is bound once and calls the latest).
 * Instant, never animated: `onHandled` runs after each handled key.
 */
export function usePlayerKeyboard(enabled: boolean, onAction: (action: Action | "escape") => boolean, onHandled: () => void) {
  const latest = useRef({ onAction, onHandled });
  latest.current = { onAction, onHandled };
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      // A dropdown has the keyboard while it's focused or open (arrows, Space, Esc are its own).
      if ((e.target as HTMLElement).closest?.("[aria-haspopup=listbox], [role=listbox], .srcf-popover")) return;
      const action = e.key === "Escape" ? "escape" : actionFor(e, "player");
      if (action && latest.current.onAction(action)) {
        e.preventDefault();
        latest.current.onHandled();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
