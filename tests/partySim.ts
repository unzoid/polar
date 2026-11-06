// The simulated watch party the party tests run on (#155, #156): each member a
// real room (room.ts) and a real follower (partyFollower.ts) on a fake engine,
// talking through a fake Realtime server, all on one simulated clock.
import { expect } from "bun:test";
import type { AccountBackend, PartyHandlers, PartyPresence } from "../src/lib/account/backend";
import { parsePresence } from "../src/lib/party/messages";
import { createPartyRoom, memberStatus, type PartyClock, type PartyRoom, type PartyState } from "../src/lib/party/room";
import { createPartyFollower } from "../src/components/player/partyFollower";
import type { MediaLike } from "../src/components/player/mpvMedia";

// --- Clock -------------------------------------------------------------------

export class Sim implements PartyClock {
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
export class Hub {
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
        reconnect: () =>
          this.sim.after(() => {
            this.track(id, current);
            handlers.onStatus("joined");
          }, lag * 2),
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
export class FakeMedia extends EventTarget implements MediaLike {
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

export const MEDIA = { type: "series" as const, metaId: "tt0000155", videoId: "tt0000155:1:3", label: "S1:E3 · The Lighthouse Keeper" };

export interface Member {
  room: PartyRoom;
  media: FakeMedia | null;
  follower?: ReturnType<typeof createPartyFollower>;
  stop?: () => void;
}

/** What a member's room talks through: the plain fake server, or the fault-injecting one (partyChaos.ts). */
export interface SimServer {
  party: AccountBackend["party"];
  setLag(id: string, ms: number): void;
}

export function setup<H extends SimServer = Hub>(makeHub: (sim: Sim) => H = (sim) => new Hub(sim) as unknown as H) {
  const sim = new Sim();
  const hub = makeHub(sim);
  let n = 0;
  /** `freshIds`: each join after the first gets a new id, as the app's do (member-2, member-2-2, …). */
  const member = (lag?: number, { freshIds = false } = {}): Member => {
    const id = `member-${++n}`;
    let joins = 0;
    hub.setLag(id, lag ?? 30 + n * 25);
    const room = createPartyRoom({
      party: () => hub.party,
      clock: sim,
      chime: () => {},
      formatTime: (s) => `${s}`,
      newId: () => {
        const next = freshIds && joins++ ? `${id}-${joins}` : id;
        hub.setLag(next, lag ?? 30 + n * 25);
        return next;
      },
      randomBytes: (k) => new Uint8Array(k).fill(7),
    });
    return { room, media: null };
  };
  /** Open the player on the room's video: what Player.tsx and usePartySync do. */
  const watch = (m: Member, start: number, engine: ConstructorParameters<typeof FakeMedia>[1] = {}, loadMs?: number) => {
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
    m.follower = f;
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
    media.load(start, loadMs);
    return media;
  };
  return { sim, hub, member, watch };
}

/** Start a party on A, playing at `at`, and join B; both players up. */
export function partyOfTwo(engineB: ConstructorParameters<typeof FakeMedia>[1] = {}, { pauseFirst = false } = {}) {
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

export const statusOf = (p: PartyState, id: string) => {
  const m = p.members.find((x) => x.id === id);
  return m ? memberStatus(m, p.playback) : "gone";
};
