import { useCallback, useRef, useSyncExternalStore } from "react";
import type { MediaLike } from "./mpvMedia";

/** Where the playhead is, as of the media's last time report. */
export interface MediaTime {
  current: number;
  /** 0 until known; Infinity for a live stream. */
  duration: number;
}

const ZERO: MediaTime = { current: 0, duration: 0 };
const EVENTS = ["timeupdate", "loadedmetadata", "durationchange"] as const;

const read = (m: MediaLike): MediaTime => ({ current: m.currentTime, duration: m.duration || 0 });

/**
 * A value derived from the playhead, re-rendering only when that value changes.
 *
 * The media reports time about 4 times a second; the player itself only needs
 * a few facts from it (a whole-second duration, "past 75 %", "in the credits"),
 * so each part subscribes with a `select` that returns a primitive, and the
 * rest of the player stays still. The time is read when the media reports it,
 * not on every call, so the snapshot is stable between reports (mpv's
 * `currentTime` is interpolated and would differ from one call to the next).
 */
export function useMediaTime<T>(media: MediaLike | null, select: (t: MediaTime) => T): T {
  const snap = useRef<MediaTime>(ZERO);
  const subscribe = useCallback(
    (changed: () => void) => {
      if (!media) {
        snap.current = ZERO;
        return () => {};
      }
      const update = () => {
        snap.current = read(media);
        changed();
      };
      snap.current = read(media);
      for (const e of EVENTS) media.addEventListener(e, update);
      return () => {
        for (const e of EVENTS) media.removeEventListener(e, update);
      };
    },
    [media],
  );
  return useSyncExternalStore(subscribe, () => select(snap.current));
}
