import { useEffect, useRef } from "react";
import {
  expectedPosition,
  getParty,
  partyAct,
  setPartyWaiting,
  useParty,
  type PartyMedia,
  type StreamHint,
} from "../../lib/party/party";
import type { MediaLike } from "./mpvMedia";

/** Within this, leave it alone. */
const IN_SYNC = 0.12;
/** Beyond this, speed up or slow down a little (inaudible) instead of jumping. */
const NUDGE = 0.3;
/** Beyond this, seek. */
const JUMP = 2;
/** A buffering stall shorter than this doesn't hold the room. */
const STALL_MS = 1200;
/** Our own play/pause/seek echoes back from the engine within this. */
const ECHO_MS = 1500;

/**
 * Keeps this player on the watch party's timeline, and turns what the viewer
 * does here (pause, seek, skip intro, a new episode) into room actions.
 *
 * Local actions are recognised by the engine's own events disagreeing with
 * the room, so every control path — keyboard, scrubber, skip, autoplay —
 * is covered without each one knowing about parties.
 */
export function usePartySync({
  media,
  current,
  started,
  buffering,
  hint,
}: {
  media: MediaLike | null;
  current: PartyMedia;
  started: boolean;
  buffering: boolean;
  /** The file this player resolved, once it has. */
  hint?: StreamHint;
}) {
  const party = useParty();
  const inParty = !!party;
  const videoId = current.videoId;
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const startedRef = useRef(started);
  startedRef.current = started;
  /** The room's state has been applied here at least once since playback started. */
  const synced = useRef(false);
  const commanded = useRef({ paused: null as boolean | null, at: 0, seekAt: 0 });

  // A different video here than the room's: this player is where the viewer
  // went (episode picker, next, autoplay) — take the room along, from the top.
  useEffect(() => {
    const p = getParty()?.playback;
    if (p && p.media.videoId !== videoId) partyAct({ media: current, position: 0, paused: false });
    // Once per player: each video is a fresh mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fill in what others need: the label for their notes, the file for their source pick.
  const { label } = current;
  const pb = party?.playback;
  const roomMedia = pb?.media.videoId === videoId ? pb.media : undefined;
  useEffect(() => {
    if (!roomMedia) return;
    const missingHint = hint && !roomMedia.hint;
    const missingLabel = label && !roomMedia.label;
    if (missingHint || missingLabel) partyAct({ media: { ...roomMedia, hint: roomMedia.hint ?? hint, label: roomMedia.label ?? label } });
  }, [roomMedia, hint, label]);

  // Not on the room's video yet, loading, or stalled for more than a moment:
  // ask the room to wait.
  const onRoomVideo = !!roomMedia;
  useEffect(() => {
    if (!inParty) return;
    if (!onRoomVideo || !started) return setPartyWaiting(true);
    if (!buffering) return setPartyWaiting(false);
    const t = window.setTimeout(() => setPartyWaiting(true), STALL_MS);
    return () => window.clearTimeout(t);
  }, [inParty, onRoomVideo, started, buffering]);

  useEffect(() => {
    if (!started) synced.current = false;
  }, [started]);

  // Follow the room: play/pause, then hold drift under a tenth of a second.
  useEffect(() => {
    if (!inParty) return;
    const setRate = (m: MediaLike, r: number) => {
      if (m.playbackRate !== r) m.playbackRate = r;
    };
    const seek = (m: MediaLike, t: number) => {
      if (performance.now() - commanded.current.seekAt < ECHO_MS) return; // let the last one land
      commanded.current.seekAt = performance.now();
      m.currentTime = t;
    };
    const command = (m: MediaLike, paused: boolean) => {
      if (m.paused === paused) return;
      commanded.current = { ...commanded.current, paused, at: performance.now() };
      if (paused) m.pause();
      else m.play().catch(() => {});
    };
    const tick = () => {
      const p = getParty()?.playback;
      const m = mediaRef.current;
      if (!p || !m || p.media.videoId !== videoId || !startedRef.current || m.ended) return;
      const hold = p.paused || p.held;
      if (hold) {
        command(m, true);
        setRate(m, 1);
        if (Math.abs(m.currentTime - p.position) > 0.5) seek(m, p.position);
      } else {
        const target = expectedPosition(p);
        if (Number.isFinite(m.duration) && m.duration > 0 && target >= m.duration - 1) return; // let it end on its own
        const drift = m.currentTime - target;
        if (Math.abs(drift) > JUMP) {
          setRate(m, 1);
          seek(m, target);
        } else if (Math.abs(drift) > NUDGE) setRate(m, drift > 0 ? 0.95 : 1.05);
        else if (Math.abs(drift) < IN_SYNC) setRate(m, 1);
        command(m, false);
      }
      synced.current = true;
    };
    tick();
    const t = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(t);
      const m = mediaRef.current;
      if (m) setRate(m, 1);
    };
  }, [inParty, videoId, pb?.v, pb?.by, started]);

  // What the viewer does here becomes the room's.
  useEffect(() => {
    if (!media || !inParty) return;
    const room = () => {
      const p = getParty()?.playback;
      return synced.current && p && p.media.videoId === videoId ? p : null;
    };
    const onPlayPause = () => {
      const p = room();
      if (!p || media.ended) return;
      const c = commanded.current;
      if (media.paused === c.paused && performance.now() - c.at < ECHO_MS) return; // our own
      if (media.paused === p.paused) return; // a hold, or already agreed
      if (Number.isFinite(media.duration) && media.currentTime >= media.duration - 1) return; // the end pausing itself
      partyAct({ paused: media.paused, position: media.currentTime });
    };
    const onSeeking = () => {
      const p = room();
      if (!p || performance.now() - commanded.current.seekAt < ECHO_MS) return;
      if (Math.abs(media.currentTime - expectedPosition(p)) < JUMP) return;
      partyAct({ position: media.currentTime });
    };
    media.addEventListener("play", onPlayPause);
    media.addEventListener("pause", onPlayPause);
    media.addEventListener("seeking", onSeeking);
    return () => {
      media.removeEventListener("play", onPlayPause);
      media.removeEventListener("pause", onPlayPause);
      media.removeEventListener("seeking", onSeeking);
    };
  }, [media, inParty, videoId]);
}
