import type { Playback } from "../../lib/party";
import type { MediaLike } from "./mpvMedia";

/** Within this, leave it alone. */
const IN_SYNC = 0.12;
/** Beyond this, speed up or slow down a little (inaudible) instead of jumping. */
const NUDGE = 0.3;
/** Beyond this, seek. */
export const JUMP = 2;
/** Our own play/pause/seek echoes back from the engine within this. */
const ECHO_MS = 1500;
/** Paused, the room is exactly where it stopped: a move this far is the viewer's. */
const PAUSED_MOVE = 0.25;
/** Paused, the room moving (a paused seek or a frame step, #243) is followed to within this: a frame is 1/24 s. */
const EXACT = 0.005;
/** A seek here waits this long for the next before it's the room's: one update for a drag, held arrow keys or a wheel. */
export const SEEK_SETTLE_MS = 300;
export const FOLLOW_MS = 250;
/** What a frame step (frameStep.ts) fires on the media once it has landed: a paused seek, however small. */
export const FRAME_STEP_EVENT = "framestep";

export interface FollowerDeps {
  media: MediaLike;
  videoId: string;
  /** The room's timeline, or null out of a party. */
  room: () => Playback | null;
  act: (patch: { paused?: boolean; position?: number }) => void;
  expected: (p: Playback) => number;
  now: () => number;
  /** The first frame has played. */
  started: () => boolean;
  /** Stalled, or a seek still loading. */
  buffering: () => boolean;
}

/**
 * Keeps one player on the watch party's timeline, and turns what the viewer
 * does there (pause, seek, skip intro) into room actions. Plain code, driven
 * by usePartySync in the app and by a simulated room in
 * tests/partySync.test.ts.
 *
 * Local actions are recognised by the engine's own events disagreeing with
 * the room, so every control path — keyboard, scrubber, skip, autoplay —
 * is covered without each one knowing about parties. Until the engine has
 * once matched the room's play/pause, nothing it does is the viewer's: a
 * player starts by playing, and mpv reports that start after it has already
 * been told to pause, which read as the joiner pressing play (#155).
 */
export function createPartyFollower(d: FollowerDeps) {
  const { media: m } = d;
  /** The engine has matched the room's play/pause since playback started. */
  let synced = false;
  let commanded = { paused: null as boolean | null, at: 0, seekAt: 0, seekTo: NaN };
  /** How long a seek here takes to play again (s): catch-up seeks aim that far ahead. */
  let seekLag = 0.5;
  /** When the last catch-up seek was made, until it has landed. */
  let seekSent: number | null = null;
  /** When the viewer last sought here, until the room has been told where it settled. */
  let viewerSeek: number | null = null;
  /** Paused, the room's position as last followed: when it changes, it's someone's paused seek or frame step. */
  let heldAt: number | null = null;
  let stopped = false;

  const onRoom = () => {
    const p = d.room();
    return p && p.media.videoId === d.videoId ? p : null;
  };
  const setRate = (r: number) => {
    if (m.playbackRate !== r) m.playbackRate = r;
  };
  const seek = (t: number) => {
    if (seekSent != null) return; // let the last one land
    commanded.seekAt = seekSent = d.now();
    commanded.seekTo = t;
    m.currentTime = t;
  };
  const command = (paused: boolean) => {
    if (m.paused === paused) return;
    commanded = { ...commanded, paused, at: d.now() };
    if (paused) m.pause();
    else m.play().catch(() => {});
  };

  /** Follow the room: play/pause, then hold drift under a tenth of a second. */
  function tick() {
    const p = onRoom();
    if (stopped || !p || !d.started() || m.ended) return;
    const hold = p.paused || p.held;
    // Play/pause always follows the room at once, even mid-seek.
    command(hold);
    if (m.paused === hold) synced = true;
    const now = d.now();
    // The viewer's seek, once it has settled: the room's, paused or not.
    if (viewerSeek != null) {
      if (now - viewerSeek < SEEK_SETTLE_MS) return;
      viewerSeek = null;
      seekSent = now;
      d.act({ position: m.currentTime });
      return;
    }
    // A seek still loading: measure it once it plays, and judge drift only after.
    if (seekSent != null) {
      if (d.buffering() || now - seekSent < 300) return;
      const took = (now - seekSent) / 1000;
      seekLag = Math.min(8, Math.max(0.2, seekLag * 0.5 + took * 0.5));
      seekSent = null;
    }
    if (d.buffering()) return; // stalled: the drift is the stall's, not ours to fix yet
    if (hold) {
      setRate(1);
      // A move of the paused room lands exactly where it went (the same frame for everyone);
      // otherwise a player that stopped a little apart (paused mid-drift) is left where it is.
      const moved = heldAt != null && p.position !== heldAt;
      heldAt = p.position;
      if (Math.abs(m.currentTime - p.position) > (moved ? EXACT : 0.5)) seek(p.position);
      return;
    }
    heldAt = null;
    const target = d.expected(p);
    if (Number.isFinite(m.duration) && m.duration > 0 && target >= m.duration - 1) return; // let it end on its own
    const drift = m.currentTime - target;
    if (Math.abs(drift) > JUMP) {
      setRate(1);
      // Aim where the room will be by the time this seek plays.
      seek(target + seekLag);
    } else if (Math.abs(drift) > NUDGE) setRate(drift > 0 ? 0.95 : 1.05);
    else if (Math.abs(drift) < IN_SYNC) setRate(1);
  }

  /** The viewer's own action, if it is one. */
  const viewer = () => (!stopped && synced ? onRoom() : null);

  function onPlayPause() {
    const p = viewer();
    if (!p || m.ended) return;
    if (m.paused === commanded.paused && d.now() - commanded.at < ECHO_MS) return; // our own
    if (m.paused === p.paused) return; // a hold, or already agreed
    if (Number.isFinite(m.duration) && m.currentTime >= m.duration - 1) return; // the end pausing itself
    d.act({ paused: m.paused, position: m.currentTime });
  }

  function onSeeking() {
    const p = viewer();
    if (!p) return;
    // Our own catch-up seek, echoed by the engine.
    if (d.now() - commanded.seekAt < ECHO_MS && Math.abs(m.currentTime - commanded.seekTo) < PAUSED_MOVE) return;
    // Mid-burst, every step counts, back where it started included; otherwise, more than drift.
    const hold = p.paused || p.held;
    if (viewerSeek == null && Math.abs(m.currentTime - d.expected(p)) < (hold ? PAUSED_MOVE : JUMP)) return;
    viewerSeek = d.now();
  }

  /** The viewer stepped a frame (frameStep.ts): a paused seek, however small. */
  function onStep() {
    if (viewer()) viewerSeek = d.now();
  }

  return {
    tick,
    onPlayPause,
    onSeeking,
    onStep,
    /** Playback (re)starting: the engine has to match the room again before it speaks for the viewer. */
    restart() {
      synced = false;
      viewerSeek = null;
    },
    /** Sync now: straight to where the room is, however close this player already thinks it is. */
    jump() {
      const p = onRoom();
      if (stopped || !p || !d.started()) return;
      seekSent = viewerSeek = heldAt = null;
      setRate(1);
      const hold = p.paused || p.held;
      seek(hold ? p.position : d.expected(p) + seekLag);
    },
    /** Leaving the player: from here on nothing this player does is the room's. */
    stop() {
      stopped = true;
      setRate(1);
    },
  };
}
