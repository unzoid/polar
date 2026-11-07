import { storeLocal } from "../errors";
import { isRecord, num, storedJson } from "../parse";
import type { SourceRecord } from "./bestMatch";

/**
 * What worked before (#230): per add-on and per release group, how often a source
 * from it started and played through on this device, how long it took to start,
 * and when it last failed. Kept on this device only (nothing about which title,
 * no links), for Best Match (bestMatch.ts). Also what this connection carries
 * while playing, in Mbps.
 */

const KEY = "polar.sourceHistory";
/** The most kinds of source kept; the least recently used go first. */
const MAX = 200;
/** How much a new throughput sample moves the connection's figure. */
const SPEED_WEIGHT = 0.3;

interface Stored {
  records: Record<string, SourceRecord & { used: number }>;
  connectionMbps: number | null;
}

function read(storage: Pick<Storage, "getItem"> | undefined): Stored {
  const v = storedJson(storage, KEY);
  const out: Stored = { records: {}, connectionMbps: null };
  if (!isRecord(v)) return out;
  out.connectionMbps = num(v.connectionMbps) ?? null;
  if (isRecord(v.records)) {
    for (const [k, r] of Object.entries(v.records)) {
      if (!isRecord(r)) continue;
      const n = (x: unknown) => Math.max(0, num(x) ?? 0);
      out.records[k] = {
        tries: n(r.tries),
        starts: n(r.starts),
        fails: n(r.fails),
        through: n(r.through),
        startMs: n(r.startMs),
        lastFail: num(r.lastFail),
        used: n(r.used),
      };
    }
  }
  return out;
}

let state: Stored = read(globalThis.localStorage);

const keyOf = (kind: "addon" | "group", name: string) => `${kind}:${name.trim().toLowerCase()}`;

function save() {
  const entries = Object.entries(state.records);
  if (entries.length > MAX) state.records = Object.fromEntries(entries.sort((a, b) => b[1].used - a[1].used).slice(0, MAX));
  storeLocal(KEY, JSON.stringify(state));
}

/** The add-on and release group a source came from. */
export interface SourceKind {
  addon?: string;
  group?: string | null;
}

function update(kind: SourceKind, now: number, change: (r: SourceRecord) => void) {
  const keys = [kind.addon && keyOf("addon", kind.addon), kind.group && keyOf("group", kind.group)].filter((k): k is string => !!k);
  if (!keys.length) return;
  for (const k of keys) {
    const r = state.records[k] ?? { tries: 0, starts: 0, fails: 0, through: 0, startMs: 0, used: 0 };
    change(r);
    r.used = now;
    state.records[k] = r;
  }
  save();
}

/** The player is opening a source of this kind. */
export const recordTry = (kind: SourceKind, now = Date.now()) => update(kind, now, (r) => r.tries++);
/** It showed a picture, `ms` after the player began on it. */
export const recordStart = (kind: SourceKind, ms: number, now = Date.now()) =>
  update(kind, now, (r) => {
    r.starts++;
    r.startMs += Math.max(0, Math.min(ms, 120_000));
  });
/** It didn't play. */
export const recordFail = (kind: SourceKind, now = Date.now()) =>
  update(kind, now, (r) => {
    r.fails++;
    r.lastFail = now;
  });
/** It played to the end (or near it). */
export const recordPlayedThrough = (kind: SourceKind, now = Date.now()) => update(kind, now, (r) => r.through++);

/** How sources from an add-on or a release group did on this device. */
export function sourceRecord(kind: "addon" | "group", name: string): SourceRecord | undefined {
  const r = state.records[keyOf(kind, name)];
  if (!r) return undefined;
  const { used: _, ...rec } = r;
  return rec;
}

/** What playback measured (megabits per second); joins the earlier figure gently. */
export function recordThroughput(mbps: number) {
  if (!Number.isFinite(mbps) || mbps <= 0) return;
  const was = state.connectionMbps;
  state.connectionMbps = was == null ? mbps : was + (mbps - was) * SPEED_WEIGHT;
  save();
}

/** What this connection carries while playing, as measured; null until it has been. */
export const connectionMbps = () => state.connectionMbps;

/** Forget everything (tests, and Settings' reset if it comes to that). */
export function resetSourceHistory(storage: Pick<Storage, "getItem"> | undefined = undefined) {
  state = read(storage);
}
