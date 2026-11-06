import { useEffect, useRef } from "react";
import { actionFor, type Action } from "../../lib/settings";
import { dismissTop } from "../../lib/ui";
import { isTvMode } from "../../tv/tvMode";

/** Keys that back out of the player: Esc always; in TV mode also Backspace and a remote's Back, as on the other TV screens. */
function isBack(e: KeyboardEvent): boolean {
  if (e.key === "Escape") return true;
  return isTvMode() && (e.key === "Backspace" || e.key === "GoBack" || e.key === "BrowserBack");
}

/**
 * The player's keyboard: shortcuts as bound in Settings → Controls, and Esc
 * (on TV also Backspace and Back), which always backs out. `onAction` returns whether it handled the key; it
 * may change every render (the listener is bound once and calls the latest).
 * Instant, never animated: `onHandled` runs after each handled key, with its action.
 */
export function usePlayerKeyboard(enabled: boolean, onAction: (action: Action | "escape") => boolean, onHandled: (action: Action | "escape") => void) {
  const latest = useRef({ onAction, onHandled });
  latest.current = { onAction, onHandled };
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      // A dropdown has the keyboard while it's focused or open (arrows, Space, Esc are its own).
      if ((e.target as HTMLElement).closest?.("[aria-haspopup=listbox], [role=listbox], .srcf-popover")) return;
      // A watch party's link question (PartyHost) is over the player and holds focus: its keys are its own.
      if ((e.target as HTMLElement).closest?.(".party-link-confirm")) return;
      // A source's info panel (#229) and a TV source row's menu hold focus over the player the same way.
      if ((e.target as HTMLElement).closest?.(".source-info, .tv-source-menu")) {
        // A remote's Back closes them as Esc does (lib/ui/dismiss.ts hears only Esc).
        if (isBack(e) && e.key !== "Escape" && dismissTop()) e.preventDefault();
        return;
      }
      const action = isBack(e) ? "escape" : actionFor(e, "player");
      if (action && latest.current.onAction(action)) {
        e.preventDefault();
        latest.current.onHandled(action);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
