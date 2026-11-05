/**
 * Episodes autoplayed in a row with nobody touching anything, for "Still
 * watching?" (Settings → Playback). Kept here, not in the player: each episode
 * is a fresh Player, and the count has to carry over from one to the next.
 */
import { useEffect } from "react";

let streak = 0;

export const autoplayStreak = () => streak;
export const countAutoplay = () => void (streak += 1);
export const resetAutoplay = () => void (streak = 0);

/** Any deliberate input means someone's still there: start counting again. */
export function useResetAutoplayOnInput() {
  useEffect(() => {
    const events = ["keydown", "pointerdown", "wheel"] as const;
    for (const e of events) window.addEventListener(e, resetAutoplay);
    return () => {
      for (const e of events) window.removeEventListener(e, resetAutoplay);
    };
  }, []);
}
