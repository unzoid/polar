import { useEffect, useRef, useState } from "react";
import {
  expectedPosition,
  getParty,
  partyAct,
  reportPosition,
  setPartyAway,
  setPartyBuffering,
  setPartyWaiting,
  useParty,
  type PartyMedia,
  type StreamHint,
} from "../../lib/party";
import { isMpv, type MediaLike } from "./mpvMedia";
import { createPartyFollower, FOLLOW_MS } from "./partyFollower";

/** A stall shorter than this (a catch-up seek loading) isn't worth showing the room. */
const BUFFERING_SHOWN_MS = 1000;
/** How often this player tells the room where it is, for "4 s behind". */
const REPORT_MS = 5000;

/**
 * Keeps this player on the watch party's timeline (partyFollower.ts), and
 * tells the room how this member is: loading, buffering, or away once the
 * viewer leaves the player.
 */
export function usePartySync({
  media,
  current,
  started,
  buffering,
  hint,
  leaving,
}: {
  media: MediaLike | null;
  current: PartyMedia;
  started: boolean;
  buffering: boolean;
  /** The file this player resolved, once it has. */
  hint?: StreamHint;
  /** Fading out after Back: the viewer has left, whatever the engine still does. */
  leaving: boolean;
}) {
  const party = useParty();
  const inParty = !!party;
  const videoId = current.videoId;
  const startedRef = useRef(started);
  startedRef.current = started;
  const bufferingRef = useRef(buffering);
  bufferingRef.current = buffering;

  // A different video here than the room's: this player is where the viewer
  // went (episode picker, next, autoplay) — take the room along, from the top.
  // Where only the host controls playback, a member can't: it watches this on
  // its own, away from the room (which doesn't wait for it), until "Go to the
  // current stream" or the room's next video brings it back.
  const [onOwn, setOnOwn] = useState(false);
  useEffect(() => {
    const p = getParty()?.playback;
    if (p && p.media.videoId !== videoId && !partyAct({ media: current, position: 0, paused: false })) setOnOwn(true);
    // Once per player: each video is a fresh mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fill in what others need: the label for their notes, the file for their source pick.
  const { label } = current;
  const pb = party?.playback;
  const roomMedia = pb?.media.videoId === videoId ? pb.media : undefined;
  useEffect(() => {
    if (!roomMedia || leaving) return;
    const missingHint = hint && !roomMedia.hint;
    const missingLabel = label && !roomMedia.label;
    if (missingHint || missingLabel) partyAct({ media: { ...roomMedia, hint: roomMedia.hint ?? hint, label: roomMedia.label ?? label } });
  }, [roomMedia, hint, label, leaving]);

  // Not on the room's video yet, or still loading it: ask the room to wait.
  // Only then. A stall mid-video catches up on its own (below); holding the
  // room for it made each catch-up seek a new hold, and play/pause in between
  // went nowhere.
  const onRoomVideo = !!roomMedia;
  const own = onOwn && !onRoomVideo;
  useEffect(() => {
    if (inParty && !leaving && !own) setPartyWaiting(!onRoomVideo || !started);
  }, [inParty, onRoomVideo, started, leaving, own]);

  // A stall that lasts is shown to the others as Buffering, not waited for.
  useEffect(() => {
    if (!inParty || leaving) return;
    if (!buffering || !started) return setPartyBuffering(false);
    const t = window.setTimeout(() => setPartyBuffering(true), BUFFERING_SHOWN_MS);
    return () => window.clearTimeout(t);
  }, [inParty, buffering, started, leaving]);

  // In the player, or out browsing (the party goes on; the room stops waiting for
  // you). Away from the moment Back is pressed, not when the fade-out ends.
  const away = leaving || own;
  useEffect(() => {
    if (!inParty) return;
    setPartyAway(away);
    return () => setPartyAway(true);
  }, [inParty, away]);

  // Seeks land on the exact frame asked for: a keyframe seek can land seconds
  // short, which reads as drift and seeks again — the room rubber-banding.
  useEffect(() => {
    if (!inParty || !isMpv(media)) return;
    media.exactSeeks = true;
    return () => {
      media.exactSeeks = false;
    };
  }, [inParty, media]);

  // Follow the room, and make what the viewer does here the room's.
  const follower = useRef<ReturnType<typeof createPartyFollower> | null>(null);
  useEffect(() => {
    if (!media || !inParty || leaving) return;
    const f = createPartyFollower({
      media,
      videoId,
      room: () => getParty()?.playback ?? null,
      act: partyAct,
      expected: expectedPosition,
      now: () => performance.now(),
      started: () => startedRef.current,
      buffering: () => bufferingRef.current,
    });
    follower.current = f;
    f.tick();
    const t = window.setInterval(f.tick, FOLLOW_MS);
    const { onPlayPause, onSeeking } = f;
    media.addEventListener("play", onPlayPause);
    media.addEventListener("pause", onPlayPause);
    media.addEventListener("seeking", onSeeking);
    return () => {
      // Events the engine fires after this (the element going away pauses it) aren't the viewer's.
      f.stop();
      follower.current = null;
      window.clearInterval(t);
      media.removeEventListener("play", onPlayPause);
      media.removeEventListener("pause", onPlayPause);
      media.removeEventListener("seeking", onSeeking);
    };
  }, [media, inParty, videoId, leaving]);

  // Where this player is, now and then, so the others see if it falls behind.
  useEffect(() => {
    if (!media || !inParty || leaving || !onRoomVideo || !started) return;
    const report = () => reportPosition(videoId, media.currentTime, media.paused);
    report();
    const t = window.setInterval(report, REPORT_MS);
    return () => window.clearInterval(t);
  }, [media, inParty, leaving, onRoomVideo, started, videoId]);

  // Sync now (party menu): straight to the room's position.
  const resync = party?.resync ?? 0;
  useEffect(() => {
    if (resync) follower.current?.jump();
  }, [resync]);

  // A new timeline is followed at once, not at the next tick.
  useEffect(() => follower.current?.tick(), [pb?.v, pb?.by]);

  // Playing again from the start of a load: the engine has to match the room before it speaks for the viewer.
  useEffect(() => {
    if (started) follower.current?.tick();
    else follower.current?.restart();
  }, [started]);
}
