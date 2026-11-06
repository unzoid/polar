// Two simulated watch-party members (#155): each a real room (room.ts) and a
// real follower (partyFollower.ts) on a fake engine, talking through a fake
// Realtime server, all on one simulated clock.
import { expect, test } from "bun:test";
import type { PartyHandlers, PartyPresence } from "../src/lib/account/backend";
import { parsePresence } from "../src/lib/party/messages";
import { createPartyRoom, GONE_MS, memberStatus, type PartyClock, type PartyRoom, type PartyState } from "../src/lib/party/room";
import { createPartyFollower } from "../src/components/player/partyFollower";
import type { MediaLike } from "../src/components/player/mpvMedia";

// --- Clock -------------------------------------------------------------------

class Sim implements PartyClock {
  t = 1000;
  private seq = 0;
  private q: { at: number; seq: number; fn: () => void; dead?: boolean }[] = [];
  now = () => this.t;
  wall = () => this.t;
  after(fn: () => void, ms: number) {
    const job = { at: this.t + ms, seq: ++this.seq, fn };
    this.q.push(job);
    return () => void (job.dead = true);
  }
  every(fn: () => void, ms: number) {
    let cancel = () => {};
    const run = () => {
      cancel = this.after(run, ms);
      fn();
    };
    cancel = this.after(run, ms);
    return () => cancel();
  }
  run(ms: number) {
    const until = this.t + ms;
    for (;;) {
      this.q = this.q.filter((j) => !j.dead);
      const next = this.q.reduce<(typeof this.q)[number] | null>((a, j) => (!a || j.at < a.at || (j.at === a.at && j.seq < a.seq) ? j : a), null);
      if (!next || next.at > until) break;
      this.q.splice(this.q.indexOf(next), 1);
      this.t = next.at;
      next.fn();
    }
    this.t = until;
  }
}

// --- Realtime server ---------------------------------------------------------

/** Broadcast with self-echo and presence, each client a fixed one-way latency away. */
class Hub {
  private clients = new Map<string, { lag: number; handlers: PartyHandlers }>();
  private metas = new Map<string, Record<string, unknown>[]>();
  private ref = 0;
  /** Track calls from these members the server drops (a lost update). */
  dropTracks = new Set<string>();
  /** Broadcasts from these members the server drops. */
  dropMessages = new Set<string>();
  constructor(private sim: Sim) {}

  readonly party = {
    connect: (_code: string, me: PartyPresence, handlers: PartyHandlers) => {
      const id = me.id;
      const lag = this.lags.get(id) ?? 40;
      this.clients.set(id, { lag, handlers });
      let current = me;
      this.sim.after(() => {
        this.track(id, current);
        handlers.onStatus("joined");
      }, lag * 2);
      return {
        send: (message: Record<string, unknown>) => this.sim.after(() => !this.dropMessages.has(id) && this.broadcast(message), lag),
        track: (p: PartyPresence) => {
          current = p;
          this.sim.after(() => this.track(id, p), lag);
        },
        close: () =>
          this.sim.after(() => {
            this.clients.delete(id);
            this.lose(id);
          }, lag),
      };
    },
  };
  private lags = new Map<string, number>();
  setLag(id: string, ms: number) {
    this.lags.set(id, ms);
  }

  private track(id: string, p: PartyPresence) {
    if (!this.clients.has(id) || this.dropTracks.has(id)) return;
    this.metas.set(id, [{ ...p, presence_ref: String(++this.ref) }]);
    this.sync();
  }
  /** The server forgets a member that's still connected. */
  lose(id: string) {
    this.metas.delete(id);
    this.sync();
  }
  private sync() {
    const state = Object.fromEntries(this.metas);
    for (const { lag, handlers } of this.clients.values()) {
      const copy = JSON.parse(JSON.stringify(state)) as Record<string, unknown[]>;
      this.sim.after(() => handlers.onPresence(parsePresence(copy)), lag);
    }
  }
  private broadcast(message: Record<string, unknown>) {
    for (const { lag, handlers } of this.clients.values()) this.sim.after(() => handlers.onMessage({ ...message }), lag);
  }
}

// --- Engine ------------------------------------------------------------------

/**
 * A player engine. Like mpv, play/pause take effect (and `paused` changes)
 * only when the engine reports back, `engineLag` ms later; seeks load for
 * `seekMs`; and its clock runs `skew` times real time, so it drifts.
 */
class FakeMedia extends EventTarget implements MediaLike {
  duration = 3600;
  ended = false;
  readyState = 4;
  buffered = { length: 1, start: () => 0, end: () => 3600 } as TimeRanges;
  volume = 1;
  muted = false;
  playbackRate = 1;
  started = false;
  buffering = true;
  private playing = false;
  private pos = 0;
  private last: number;
  constructor(
    private sim: Sim,
    private o: { skew?: number; engineLag?: number; seekMs?: number } = {},
  ) {
    super();
    this.last = sim.t;
  }
  private settle() {
    if (this.playing && !this.buffering) this.pos += ((this.sim.t - this.last) / 1000) * this.playbackRate * (this.o.skew ?? 1);
    this.last = this.sim.t;
  }
  get paused() {
    return !this.playing;
  }
  get currentTime() {
    this.settle();
    return this.pos;
  }
  set currentTime(t: number) {
    this.settle();
    this.pos = t;
    this.buffering = true;
    this.dispatchEvent(new Event("seeking"));
    this.sim.after(() => {
      this.settle();
      this.buffering = false;
      this.dispatchEvent(new Event("playing"));
    }, this.o.seekMs ?? 400);
  }
  /** The engine reports a play state (an mpv property change). */
  report(playing: boolean) {
    this.settle();
    if (this.playing === playing) return;
    this.playing = playing;
    this.dispatchEvent(new Event(playing ? "play" : "pause"));
  }
  play() {
    this.sim.after(() => this.report(true), this.o.engineLag ?? 60);
    return Promise.resolve();
  }
  pause() {
    this.sim.after(() => this.report(false), this.o.engineLag ?? 60);
  }
  /** What the player does with a source: open it at `start` and play, as Player.tsx does. */
  load(start: number, loadMs = 1500) {
    this.pos = start;
    this.last = this.sim.t;
    this.sim.after(() => {
      this.buffering = false;
      this.report(true);
      this.started = true;
      this.dispatchEvent(new Event("started"));
    }, loadMs);
  }
}

// --- Members -----------------------------------------------------------------

const MEDIA = { type: "series" as const, metaId: "tt0000155", videoId: "tt0000155:1:3", label: "S1:E3 · The Lighthouse Keeper" };

interface Member {
  room: PartyRoom;
  media: FakeMedia | null;
  stop?: () => void;
}

function setup() {
  const sim = new Sim();
  const hub = new Hub(sim);
  let n = 0;
  const member = (): Member => {
    const id = `member-${++n}`;
    hub.setLag(id, 30 + n * 25);
    const room = createPartyRoom({
      party: () => hub.party,
      clock: sim,
      chime: () => {},
      formatTime: (s) => `${s}`,
      newId: () => id,
      randomBytes: (k) => new Uint8Array(k).fill(7),
    });
    return { room, media: null };
  };
  /** Open the player on the room's video: what Player.tsx and usePartySync do. */
  const watch = (m: Member, start: number, engine: ConstructorParameters<typeof FakeMedia>[1] = {}) => {
    const media = new FakeMedia(sim, engine);
    m.media = media;
    const f = createPartyFollower({
      media,
      videoId: MEDIA.videoId,
      room: () => m.room.getParty()?.playback ?? null,
      act: m.room.partyAct,
      expected: m.room.expectedPosition,
      now: sim.now,
      started: () => media.started,
      buffering: () => media.buffering,
    });
    media.addEventListener("play", f.onPlayPause);
    media.addEventListener("pause", f.onPlayPause);
    media.addEventListener("seeking", f.onSeeking);
    media.addEventListener("started", () => {
      m.room.setPartyWaiting(false);
      f.tick();
    });
    const stopTicks = sim.every(f.tick, 250);
    m.room.setPartyAway(false);
    m.stop = () => {
      f.stop();
      stopTicks();
      m.room.setPartyAway(true);
    };
    media.load(start);
    return media;
  };
  return { sim, hub, member, watch };
}

/** Start a party on A, playing at `at`, and join B; both players up. */
function partyOfTwo(engineB: ConstructorParameters<typeof FakeMedia>[1] = {}, { pauseFirst = false } = {}) {
  const s = setup();
  const a = s.member();
  const b = s.member();
  const ma = s.watch(a, 100);
  s.sim.run(2000);
  a.room.startParty(MEDIA, ma.currentTime, false, { name: "Ash", avatar: "" });
  s.sim.run(1000);
  if (pauseFirst) {
    ma.pause(); // the viewer pauses
    s.sim.run(2000);
  }
  const code = a.room.getParty()!.code;
  void b.room.joinParty(code, { name: "Bea", avatar: "" });
  s.sim.run(1000);
  expect(b.room.getParty()?.playback).toBeTruthy(); // the room's timeline arrived: joined
  return { ...s, a, b, ma, mb: s.watch(b, b.room.partyPosition(MEDIA.videoId)!, engineB) };
}

const statusOf = (p: PartyState, id: string) => {
  const m = p.members.find((x) => x.id === id);
  return m ? memberStatus(m, p.playback) : "gone";
};

// --- Tests -------------------------------------------------------------------

test("joining a paused party leaves it paused, and the joiner lands paused at the same frame", () => {
  const { sim, a, b, ma, mb } = partyOfTwo({}, { pauseFirst: true });
  // Never playing, on either side, from the moment B joined.
  const playedA: boolean[] = [];
  const unsub = a.room.getParty() && sim.every(() => playedA.push(!a.room.getParty()!.playback!.paused, !ma.paused), 50);
  // Like mpv: the engine reports its start once more after it has been told to pause.
  mb.addEventListener("started", () => sim.after(() => mb.report(true), 100), { once: true });
  sim.run(15_000);
  unsub?.();
  expect(playedA.some(Boolean)).toBe(false);
  expect(b.room.getParty()!.playback!.paused).toBe(true);
  expect(ma.paused && mb.paused).toBe(true);
  expect(Math.abs(ma.currentTime - mb.currentTime)).toBeLessThan(0.5);
  expect(statusOf(a.room.getParty()!, "member-2")).toBe("Paused");
  expect(statusOf(b.room.getParty()!, "member-1")).toBe("Paused");
});

test("ten minutes of play with pauses and seeks keeps two drifting players within a second", () => {
  // B's engine runs 1% fast, A's slightly slow: 7 s apart after ten minutes if nobody corrected.
  const { sim, ma, mb } = partyOfTwo({ skew: 1.01, engineLag: 120, seekMs: 900 });
  (ma as unknown as { o: { skew: number } }).o.skew = 0.998;
  sim.run(10_000);
  let worst = 0;
  let quietUntil = 0;
  const actions: [number, () => void][] = [
    [60, () => ma.pause()],
    [70, () => mb.play()],
    [150, () => (mb.currentTime = mb.currentTime + 300)],
    [260, () => mb.pause()],
    [275, () => ma.play()],
    [380, () => (ma.currentTime = ma.currentTime - 120)],
    [470, () => mb.pause()],
    [480, () => mb.play()],
  ];
  for (let s = 1; s <= 600; s++) {
    for (const [at, act] of actions)
      if (at === s) {
        act();
        quietUntil = s + 6; // a seek or resume takes a few seconds to settle on both
      }
    sim.run(1000);
    if (s > quietUntil) worst = Math.max(worst, Math.abs(ma.currentTime - mb.currentTime));
  }
  expect(worst).toBeLessThan(1);
  // Each player is held within the nudge band (0.3 s) of the room, so two may sit up to twice that apart.
  expect(Math.abs(ma.currentTime - mb.currentTime)).toBeLessThan(0.65);
});

test("an action the others missed still reaches them, instead of each side keeping its own timeline", () => {
  const { sim, hub, b, ma, mb } = partyOfTwo();
  sim.run(5000);
  // B pauses, and that message is lost on its way to A (the host).
  hub.dropMessages.add("member-2");
  mb.pause();
  sim.run(300);
  hub.dropMessages.clear();
  sim.run(15_000);
  expect(b.room.getParty()!.playback!.paused).toBe(true);
  expect(ma.paused && mb.paused).toBe(true);
  expect(Math.abs(ma.currentTime - mb.currentTime)).toBeLessThan(0.5);
});

test("leaving the player is Away on both screens, even when the server loses the update", () => {
  const { sim, hub, a, b } = partyOfTwo();
  sim.run(5000);
  expect(statusOf(a.room.getParty()!, "member-2")).toBe("Watching");
  b.stop!();
  sim.run(1000);
  expect(statusOf(a.room.getParty()!, "member-2")).toBe("Away");
  expect(statusOf(b.room.getParty()!, "member-2")).toBe("Away");
  // The server forgets B's presence while B is still connected: B notices and comes back
  // before A gives up on it, so A never shows B as gone.
  const notes: string[] = [];
  const watchNotes = sim.every(() => a.room.getParty()!.notes.forEach((n) => notes.push(n.text)), 100);
  hub.lose("member-2");
  sim.run(GONE_MS * 3);
  watchNotes();
  expect(notes).not.toContain("left");
  expect(statusOf(a.room.getParty()!, "member-2")).toBe("Away");
  expect(b.room.getParty()!.members.map((m) => m.id)).toEqual(a.room.getParty()!.members.map((m) => m.id));
});

test("Leave Party is gone for everyone at once", () => {
  const { sim, a, b } = partyOfTwo();
  sim.run(5000);
  b.stop!();
  b.room.leaveParty();
  expect(b.room.getParty()).toBeNull();
  sim.run(500); // well inside the grace for a presence blip
  expect(statusOf(a.room.getParty()!, "member-2")).toBe("gone");
  expect(a.room.getParty()!.notes.map((n) => n.text)).toContain("left");
});

test("a status update the server drops is sent again, so 'Loading' clears everywhere", () => {
  const { sim, hub, a, b } = partyOfTwo();
  // B's "loaded" update is lost: B shows itself as it is, and re-sends until A agrees.
  hub.dropTracks.add("member-2");
  sim.run(3000);
  expect(statusOf(b.room.getParty()!, "member-2")).toBe("Watching");
  hub.dropTracks.clear();
  sim.run(8000);
  expect(statusOf(a.room.getParty()!, "member-2")).toBe("Watching");
  expect(a.room.getParty()!.playback!.held).toBe(false);
});
