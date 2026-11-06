import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Volume, VolumeMuted } from "../icons";
import type { MediaLike } from "./mpvMedia";
import { VideoBackdrop } from "./VideoBackdrop";

/** How long the HUD stays after the last change. */
const LINGER_MS = 1500;
/** Apple-style springs: the level tracks presses without bounce; the HUD itself settles with a little. */
const LEVEL = { type: "spring", duration: 0.35, bounce: 0 } as const;
const PRESENCE = { type: "spring", duration: 0.4, bounce: 0.15 } as const;

export type VolumePing = { n: number; dir: "up" | "down" | "mute" };

/**
 * TV mode's volume HUD, after iOS/tvOS: a slim vertical pill at the left edge
 * that fills from the bottom, shown when the controller or remote changes the
 * volume (the chrome, with its own slider, is usually hidden then).
 *
 *  - It slides in from the edge it lives on and leaves the same way.
 *  - The level follows each press on a no-bounce spring, so a held button
 *    reads as one smooth sweep, not steps.
 *  - Pushing past full or past silent rubber-bands the pill in that direction
 *    and springs back: the press was heard, there's just no further to go.
 *  - Reduced motion: it fades in and out in place; the level jumps, no stretch.
 */
export function VolumeHud({ volume, muted, ping, media }: { volume: number; muted: boolean; ping: VolumePing; media: MediaLike | null }) {
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const pill = useRef<HTMLDivElement | null>(null);
  const last = useRef({ n: ping.n, volume });
  // Read by the ping effect without re-running it (a re-run would cancel the hide timer).
  const current = useRef({ volume, reduce });
  current.current = { volume, reduce };

  useEffect(() => {
    if (ping.n === last.current.n) return;
    const { volume, reduce } = current.current;
    const before = last.current.volume;
    last.current = { n: ping.n, volume };
    setVisible(true);
    const t = setTimeout(() => setVisible(false), LINGER_MS);

    // A press that couldn't move the level: rubber-band toward where it pushed.
    const pinned = (ping.dir === "up" && before >= 1 && volume >= 1) || (ping.dir === "down" && before <= 0 && volume <= 0);
    let frame = 0;
    if (pinned && !reduce) {
      const stretch = () => {
        const el = pill.current;
        if (!el) return;
        // Anchored on the far end, so the pill stretches the way it was pushed.
        el.style.transformOrigin = ping.dir === "up" ? "bottom" : "top";
        void animate(el, { scaleY: [1, 1.06, 1], scaleX: [1, 0.94, 1] }, { duration: 0.45, ease: [0.23, 1, 0.32, 1], times: [0, 0.3, 1] });
      };
      // The first press after a quiet spell mounts the HUD in this same update.
      if (pill.current) stretch();
      else frame = requestAnimationFrame(stretch);
    }
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(frame);
    };
  }, [ping]);

  const level = muted ? 0 : volume;
  const Icon = level === 0 ? VolumeMuted : Volume;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="volume-hud"
          role="status"
          aria-label={muted ? "Muted" : `Volume ${Math.round(volume * 100)}%`}
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: -24, scale: 0.94 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24, scale: 0.94, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } }}
          transition={PRESENCE}
        >
          <div
            ref={pill}
            className="volume-hud-pill"
          >
            {/* The blur: backdrop-filter has nothing to sample over the video
                (VideoBackdrop.tsx), so a frosted copy of just the part of the frame behind the pill. */}
            <VideoBackdrop media={media} className="volume-hud-backdrop" crop />
            <motion.div className="volume-hud-fill" initial={false} animate={{ scaleY: level }} transition={reduce ? { duration: 0 } : LEVEL} />
            <Icon className="volume-hud-icon" data-covered={level > 0.2} size="1.5rem" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
