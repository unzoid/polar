import { useEffect, useRef, type RefObject } from "react";
import { isWatched } from "../../lib/library";
import { liveTraktLink, noteTraktWatched, scrobble, sendScrobble, traktRefOf, traktSpace, type ScrobbleAction, type TraktRef } from "../../lib/trakt";
import type { ContentType } from "../../lib/types";
import type { MediaLike } from "./mpvMedia";

/**
 * Tells a linked Trakt account what plays (#85): a scrobble `start` when the video plays or
 * resumes, `pause` when it pauses, and `stop` when it ends, another video takes its place or the
 * player closes. A video Polarity counts watched that Trakt's stop didn't (stopped under Trakt's
 * 80%, or Trakt out of reach) goes into the Trakt history queue instead, so both agree.
 */
export function useTraktScrobble({
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
  /** Off for files on this device: Trakt has no way to know them. */
  enabled: boolean;
}) {
  const ref = enabled ? traktRefOf(videoId, type) : undefined;
  const key = ref ? JSON.stringify(ref) : undefined;
  /** Whether a start went out for this video since its last pause or stop. */
  const started = useRef(false);
  /** Whether this video played at all: one opened and closed unplayed sends no stop. */
  const played = useRef(false);

  const progress = () => {
    const v = media.current;
    if (!v || !v.duration || !Number.isFinite(v.duration)) return null;
    return { position: v.ended ? v.duration : v.currentTime, duration: v.duration };
  };

  const send = (of: TraktRef, action: ScrobbleAction, p: { position: number; duration: number }) =>
    scrobble(action, of, (p.position / p.duration) * 100, {
      liveLink: (renew) => liveTraktLink(traktSpace(), renew),
      send: sendScrobble,
    });

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
      void send(of, "stop", p).then((result) => {
        if (watched && result !== "watched") void noteTraktWatched([{ videoId, type }], true);
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
      void send(ref, "start", p);
    } else if (started.current) {
      started.current = false;
      void send(ref, "pause", p);
    }
    // Keyed by the item, not the object made each render; the media is read through its ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, key]);
}
