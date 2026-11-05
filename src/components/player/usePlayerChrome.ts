import { useCallback, useEffect, useRef, useState } from "react";
import { appWindow } from "../../lib/platform";

/**
 * Whether the player's controls show: any pointer movement or key brings them
 * back, and they hide after `hideAfter` ms unless the pointer rests on them
 * (`overControls`). `instant` skips the fade (keyboard and wheel).
 */
export function usePlayerChrome(hideAfter: number) {
  const [chrome, setChrome] = useState({ visible: true, instant: false });
  const hideTimer = useRef<number>(undefined);
  const overControls = useRef(false);
  const poke = useCallback(
    (instant = false) => {
      // Called on every pointer move: keep the same object when nothing changed,
      // or the whole player re-renders for each pixel the mouse travels.
      setChrome((c) => (c.visible && c.instant === instant ? c : { visible: true, instant }));
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        if (!overControls.current) setChrome({ visible: false, instant: false });
      }, hideAfter);
    },
    [hideAfter],
  );
  const hide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    setChrome({ visible: false, instant: false });
  }, []);
  // Leaving the window (alt-tab, another app, the cursor off the edge) hides it
  // now: nothing is pointing at the controls any more, so don't wait out the timer.
  useEffect(() => {
    const away = () => {
      overControls.current = false;
      hide();
    };
    const onVisibility = () => document.hidden && away();
    const root = document.documentElement;
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", onVisibility);
    root.addEventListener("mouseleave", away);
    const unlisten = appWindow.onFocusChanged((focused) => !focused && away());
    return () => {
      window.clearTimeout(hideTimer.current);
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", onVisibility);
      root.removeEventListener("mouseleave", away);
      void unlisten.then((f) => f());
    };
  }, [hide]);
  return { chrome, poke, hide, overControls };
}
