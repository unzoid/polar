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
export const FOLLOW_MS = 250;

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
  let commanded = { paused: null as boolean | null, at: 0, seekAt: 0 };
  /** How long a seek here takes to play again (s): catch-up seeks aim that far ahead. */
  let seekLag = 0.5;
  /** When the last catch-up seek was made, until it has landed. */
  let seekSent: number | null = null;
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
    // A seek still loading: measure it once it plays, and judge drift only after.
    const now = d.now();
    if (seekSent != null) {
      if (d.buffering() || now - seekSent < 300) return;
      const took = (now - seekSent) / 1000;
      seekLag = Math.min(8, Math.max(0.2, seekLag * 0.5 + took * 0.5));
      seekSent = null;
    }
    if (d.buffering()) return; // stalled: the drift is the stall's, not ours to fix yet
    if (hold) {
      setRate(1);
      if (Math.abs(m.currentTime - p.position) > 0.5) seek(p.position);
      return;
    }
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
    if (!p || d.now() - commanded.seekAt < ECHO_MS) return;
    if (Math.abs(m.currentTime - d.expected(p)) < JUMP) return;
    // Our own seek, still loading: let it land before judging drift, as for a catch-up seek.
    seekSent = d.now();
    d.act({ position: m.currentTime });
  }

  return {
    tick,
    onPlayPause,
    onSeeking,
    /** Playback (re)starting: the engine has to match the room again before it speaks for the viewer. */
    restart() {
      synced = false;
    },
    /** Leaving the player: from here on nothing this player does is the room's. */
    stop() {
      stopped = true;
      setRate(1);
    },
  };
}
