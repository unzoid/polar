// A fault-injecting stand-in for Supabase Realtime (#203), for the party harness
// (tests/partyChaos.test.ts). Closer to the real thing than partySim's Hub:
//
// - Each channel has sessions, as a Phoenix channel does: a dropped connection
//   rejoins as a new session, and the server keeps the old session's presence
//   entry until it notices it's gone.
// - Presence goes out as diffs (joins and leaves), each client applying them to
//   its own copy the way phoenix's Presence does, in order per client. An update
//   is a leave of the old entry and a join of the new one; with `split`, some
//   clients get them as two syncs (the member missing in between).
// - What a client sends reaches the server in order (one socket); from there
//   broadcasts take their own path: they can overtake presence, arrive in a
//   different order at each client, or be dropped.
// - Faults: a connection that drops (the app is told) and comes back, one that
//   dies silently (the library notices only after a while), and the server
//   forgetting an entry while the member is still connected.
import type { PartyHandlers, PartyLink, PartyPresence } from "../src/lib/account/backend";
import { parsePresence } from "../src/lib/party/messages";
import type { Sim, SimServer } from "./partySim";

/** Deterministic randomness, so a failing seed fails the same way again. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Faults {
  /** Up to this many ms added to each hop, at random. */
  jitter: number;
  /** Chance that a broadcast doesn't reach a given client. */
  drop: number;
  /** Chance that a client gets an update's leave and join as two syncs. */
  split: number;
  /** Chance that a client never gets a presence diff (lost between the server's nodes): its copy is wrong until the next. */
  miss: number;
}

export const CALM: Faults = { jitter: 0, drop: 0, split: 0, miss: 0 };

type Meta = PartyPresence & { presence_ref: string };
type PresenceState = Record<string, Meta[]>;

interface Session {
  pid: number;
  /** The server hears this session. */
  up: boolean;
  /** This session hears the server. */
  down: boolean;
  /** The server still counts it in the room. */
  live: boolean;
  /** This client's copy of the room's presence. */
  copy: PresenceState;
  /** When its last presence diff arrives: presence keeps its order per client. */
  lastPresence: number;
  /** When its last message to the server gets there: a socket keeps its order, broadcasts and presence alike. */
  lastUp: number;
}

interface Channel {
  id: string;
  handlers: PartyHandlers;
  current: PartyPresence;
  session: Session | null;
  closed: boolean;
}

export class ChaosHub implements SimServer {
  faults: Faults = { ...CALM };
  /** The server's presence: key -> entries, each with the session that tracked it. */
  private metas = new Map<string, (Meta & { pid: number })[]>();
  private channels = new Map<string, Channel>();
  private sessions = new Map<number, Channel>();
  private lags = new Map<string, number>();
  private pid = 0;
  private ref = 0;
  /** Everything the server did, for a failing run's report. */
  readonly trace: string[] = [];
  /** Scripted faults, for the cases kept from failed runs: broadcasts lost from one member to another (`from>to`, `from>*`, `from>to:type`). */
  readonly lost = new Set<string>();
  /** Members who miss every presence diff while listed here. */
  readonly missPresence = new Set<string>();

  constructor(
    private sim: Sim,
    private random: () => number,
  ) {}

  setLag(id: string, ms: number) {
    this.lags.set(id, ms);
  }

  private lag(id: string) {
    return this.lags.get(id) ?? 40;
  }

  private jitter() {
    return Math.floor(this.random() * this.faults.jitter);
  }

  private note(text: string) {
    this.trace.push(`${this.sim.now()} ${text}`);
    if (this.trace.length > 400) this.trace.shift();
  }

  readonly party = {
    connect: (_code: string, me: PartyPresence, handlers: PartyHandlers): PartyLink => {
      const ch: Channel = { id: me.id, handlers, current: me, session: null, closed: false };
      this.channels.set(me.id, ch);
      this.join(ch);
      return {
        send: (message) => this.up(ch, (s) => this.broadcast(s, message)),
        track: (p) => {
          ch.current = p;
          this.up(ch, (s) => this.track(ch, s, p));
        },
        reconnect: () => {
          // As supabase.ts does: the old channel goes (its leave reaches the server if the connection still works), a new one opens.
          const s = ch.session;
          this.note(`${ch.id} reconnects (session ${s?.pid ?? "none"})`);
          if (s) {
            if (s.up) this.sim.after(() => s.live && this.leave(s), this.lag(ch.id));
            s.up = s.down = false;
          }
          ch.session = null;
          this.sim.after(() => !ch.closed && !ch.session && this.join(ch), this.lag(ch.id));
        },
        close: () => {
          ch.closed = true;
          this.up(ch, (s) => this.leave(s));
          if (ch.session) ch.session.down = false;
        },
      };
    },
  };

  /** A new session: the server's join reply, then its presence state, then (as supabase.ts does) the entry tracked. */
  private join(ch: Channel) {
    const s: Session = { pid: ++this.pid, up: true, down: true, live: false, copy: {}, lastPresence: 0, lastUp: 0 };
    ch.session = s;
    this.sessions.set(s.pid, ch);
    const lag = this.lag(ch.id);
    this.sim.after(() => {
      if (ch.closed || ch.session !== s) return;
      s.live = true;
      this.note(`${ch.id} joined (session ${s.pid})`);
      this.sim.after(() => {
        if (!s.down) return;
        ch.handlers.onStatus("joined");
        this.up(ch, (x) => this.track(ch, x, ch.current));
      }, lag);
      this.presenceTo(s, (copy) => {
        for (const k of Object.keys(copy)) delete copy[k];
        Object.assign(copy, this.snapshot());
      });
    }, lag + this.jitter());
  }

  /** From a client to the server, in order, if the connection carries it. */
  private up(ch: Channel, arrive: (s: Session) => void) {
    const s = ch.session;
    if (!s || !s.up) return;
    const at = Math.max(this.sim.now() + this.lag(ch.id) + this.jitter(), s.lastUp + 1);
    s.lastUp = at;
    this.sim.after(() => s.up && s.live && arrive(s), at - this.sim.now());
  }

  private live() {
    return [...this.sessions.entries()].filter(([, ch]) => ch.session).flatMap(([pid, ch]) => (ch.session!.pid === pid && ch.session!.live ? [ch] : []));
  }

  private broadcast(_from: Session, message: Record<string, unknown>) {
    for (const ch of this.live()) {
      const s = ch.session!;
      const from = String(message.from);
      if ([`${from}>${ch.id}`, `${from}>*`, `${from}>${ch.id}:${String(message.t)}`].some((k) => this.lost.has(k))) continue;
      if (this.random() < this.faults.drop) continue;
      this.sim.after(
        () => {
          if (s.down && ch.session === s && !ch.closed) ch.handlers.onMessage(JSON.parse(JSON.stringify(message)));
        },
        this.lag(ch.id) + this.jitter(),
      );
    }
  }

  private snapshot(): PresenceState {
    const out: PresenceState = {};
    for (const [key, list] of this.metas) out[key] = list.map(({ pid: _pid, ...m }) => ({ ...m }));
    return out;
  }

  private track(ch: Channel, s: Session, p: PartyPresence) {
    const list = this.metas.get(ch.id) ?? [];
    const old = list.find((m) => m.pid === s.pid);
    const fresh = { ...p, presence_ref: String(++this.ref), pid: s.pid };
    this.metas.set(ch.id, [...list.filter((m) => m !== old), fresh]);
    this.note(`${ch.id} tracked #${p.seq ?? 0}${p.knock ? " knock" : ""}${p.waiting ? " loading" : ""}${p.away ? " away" : ""}`);
    const { pid: _pid, ...meta } = fresh;
    const leaves = old ? [old.presence_ref] : [];
    this.diff(ch.id, [meta], leaves);
  }

  /** The server drops every entry of a session (closed, or noticed gone). */
  private leave(s: Session) {
    s.live = false;
    for (const [key, list] of this.metas) {
      const gone = list.filter((m) => m.pid === s.pid);
      if (!gone.length) continue;
      const rest = list.filter((m) => m.pid !== s.pid);
      if (rest.length) this.metas.set(key, rest);
      else this.metas.delete(key);
      this.note(`${key} left (session ${s.pid})`);
      this.diff(
        key,
        [],
        gone.map((m) => m.presence_ref),
      );
    }
  }

  /** A presence diff to every live session; with `split`, the leave and the join as two syncs. */
  private diff(key: string, joins: Meta[], leaves: string[]) {
    const join = (copy: PresenceState) => {
      if (!joins.length) return;
      const refs = new Set(joins.map((m) => m.presence_ref));
      copy[key] = [...(copy[key] ?? []).filter((m) => !refs.has(m.presence_ref)), ...joins.map((m) => ({ ...m }))];
    };
    const leave = (copy: PresenceState) => {
      if (!leaves.length || !copy[key]) return;
      copy[key] = copy[key].filter((m) => !leaves.includes(m.presence_ref));
      if (!copy[key].length) delete copy[key];
    };
    for (const ch of this.live()) {
      const s = ch.session!;
      if (ch.id !== key && (this.missPresence.has(ch.id) || this.random() < this.faults.miss)) {
        this.note(`${ch.id} misses a presence diff for ${key}`);
        continue;
      }
      if (joins.length && leaves.length && this.random() < this.faults.split) {
        this.presenceTo(s, leave);
        this.presenceTo(s, join);
      } else
        this.presenceTo(s, (copy) => {
          join(copy);
          leave(copy);
        });
    }
  }

  /** A presence change to one session, in order after the ones before it. */
  private presenceTo(s: Session, apply: (copy: PresenceState) => void) {
    const ch = this.sessions.get(s.pid);
    if (!ch) return;
    const at = Math.max(this.sim.now() + this.lag(ch.id) + this.jitter(), s.lastPresence + 1);
    s.lastPresence = at;
    this.sim.after(() => {
      apply(s.copy);
      if (s.down && ch.session === s && !ch.closed) ch.handlers.onPresence(parsePresence(JSON.parse(JSON.stringify(s.copy))));
    }, at - this.sim.now());
  }

  // --- Faults ----------------------------------------------------------------

  /**
   * The member's connection drops: the app is told at once; the server notices
   * after `noticeMs`; the library rejoins after `backMs` as a new session.
   */
  drop(id: string, backMs: number, noticeMs: number) {
    const ch = this.channels.get(id);
    const s = ch?.session;
    if (!ch || !s || ch.closed) return;
    this.note(`${id} connection dropped (session ${s.pid})`);
    s.up = s.down = false;
    ch.session = null;
    ch.handlers.onStatus("error", { setup: false, message: "connection lost" });
    this.sim.after(() => this.leave(s), noticeMs);
    this.sim.after(() => !ch.closed && !ch.session && this.join(ch), backMs);
  }

  /**
   * The member's connection dies without anyone saying so: the library only
   * notices after `noticeMs` (a missed heartbeat), and the server after `serverMs`.
   */
  silent(id: string, noticeMs: number, serverMs: number) {
    const ch = this.channels.get(id);
    const s = ch?.session;
    if (!ch || !s || ch.closed) return;
    this.note(`${id} connection silently dead (session ${s.pid})`);
    s.up = s.down = false;
    this.sim.after(() => this.leave(s), serverMs);
    this.sim.after(() => {
      if (ch.closed || ch.session !== s) return;
      ch.session = null;
      ch.handlers.onStatus("error", { setup: false, message: "heartbeat timeout" });
      this.sim.after(() => !ch.closed && !ch.session && this.join(ch), 1000);
    }, noticeMs);
  }

  /** The server forgets a member's entry while it's still connected. */
  lose(id: string) {
    const list = this.metas.get(id);
    if (!list) return;
    this.metas.delete(id);
    this.note(`${id} forgotten by the server`);
    this.diff(
      id,
      [],
      list.map((m) => m.presence_ref),
    );
  }

  /** A message as if the member's app had sent it: for what a hostile member could send. */
  inject(id: string, message: Record<string, unknown>) {
    const ch = this.channels.get(id);
    if (ch) this.up(ch, (s) => this.broadcast(s, message));
  }

  /** Whether the member's connection is up now (the app may not know otherwise). */
  connected(id: string) {
    const s = this.channels.get(id)?.session;
    return !!s && s.up && s.down && s.live;
  }
}
