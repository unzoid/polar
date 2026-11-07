import { useEffect, useRef, type RefObject } from "react";
import { isWatched } from "../../lib/library";
import type { ContentType } from "../../lib/types";
import type { MediaLike } from "./mpvMedia";

export type ScrobbleEvent = "start" | "pause" | "stop";

/** How one list service hears what plays; module-level, so the stop of a video that was replaced uses the same one. */
export interface Scrobbler<R> {
  /** The video as the service knows it; `undefined` when it can't be told about it. */
  refOf: (videoId: string, type: ContentType) => R | undefined;
  /** Sends one event with how far in it is (0–100); `watched` when the service counted it watched. */
  send: (ref: R, event: ScrobbleEvent, progress: number) => Promise<"watched" | "sent" | "none">;
  /** A video Polarity counts watched that the service's stop didn't: it goes to the service's history instead. */
  missed: (videoId: string, type: ContentType) => void;
}

/**
 * Tells a linked list service what plays (Trakt #85, Simkl #86): `start` when the video plays or
 * resumes, `pause` when it pauses, and `stop` when it ends, another video takes its place or the
 * player closes. Only on these events, never on a timer. A video Polarity counts watched that the
 * service's stop didn't (stopped under its line, or the service out of reach) goes to
 * {@link Scrobbler.missed}, so both agree.
 */
export function useScrobble<R>(
  scrobbler: Scrobbler<R>,
  {
    media,
    videoId,
    type,
    playing,
    enabled,
  }: {
    media: RefObject<MediaLike | null>;
    videoId: string;
    type: ContentType;
    /** Started and not paused. */
    playing: boolean;
    /** Off for files on this device: no service has a way to know them. */
    enabled: boolean;
  },
) {
  const ref = enabled ? scrobbler.refOf(videoId, type) : undefined;
  const key = ref ? JSON.stringify(ref) : undefined;
  /** Whether a start went out for this video since its last pause or stop. */
  const started = useRef(false);
  /** Whether this video played at all: one opened and closed unplayed sends no stop. */
  const played = useRef(false);

  const progress = () => {
    const v = media.current;
    if (!v || !v.duration || !Number.isFinite(v.duration)) return null;
    const position = v.ended ? v.duration : v.currentTime;
    return { position, duration: v.duration, percent: (position / v.duration) * 100 };
  };

  // The stop, for the video this effect began with: another video, or the player closing. Before
  // the play effect, so a new video starts unplayed and its first start counts.
  useEffect(() => {
    played.current = false;
    if (!ref) return;
    const of = ref;
    return () => {
      const p = progress();
      started.current = false;
      if (!p || !played.current) return;
      const watched = isWatched(p.position, p.duration);
      void scrobbler.send(of, "stop", p.percent).then((result) => {
        if (watched && result !== "watched") scrobbler.missed(videoId, type);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Play and pause, as they happen.
  useEffect(() => {
    const p = progress();
    if (!ref || !p) return;
    if (playing) {
      started.current = true;
      played.current = true;
      void scrobbler.send(ref, "start", p.percent);
    } else if (started.current) {
      started.current = false;
      void scrobbler.send(ref, "pause", p.percent);
    }
    // Keyed by the item, not the object made each render; the media is read through its ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, key]);
}
