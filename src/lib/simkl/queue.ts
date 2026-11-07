import { storeLocal } from "../errors";
import { isRecord, num, str, storedJson } from "../parse";
import { simkl, SimklError, simklOffline, SimklSignedOut, type SimklCaller } from "./api";
import { sameSimklRef, simklSyncBody, type SimklIds, type SimklRef, type SimklSyncItem } from "./items";
import { saveSimklLink, type SimklLink } from "./link";
import { liveSimklLink } from "./linking";

/**
 * What a profile still has to tell Simkl (#86), kept on the device so a change made offline, or
 * while Simkl is busy, goes out later: watched marks added to or taken off the history. Per
 * profile, in order; only ids, numbers and times, never the token. Changes next to each other in
 * the same direction go out as one request, as Simkl's one write a second asks for.
 *
 * Taking a film off Simkl's history takes it off the account's lists altogether (Simkl's
 * remove-from-history): a film marked unwatched in Polarity leaves Simkl's lists too.
 *
 * With the watchlist switch on, titles added to the library go onto Simkl's Plan to Watch
 * (`watchlist`, sent to `/sync/add-to-list`), and those taken off it while still there leave
 * Simkl's lists (simklSync.ts decides which).
 */
export type SimklListName = "history" | "watchlist";

export interface SimklOp {
  list: SimklListName;
  remove?: true;
  ref: SimklRef;
  /** `watched_at` for history, `to` (the list) for the watchlist. */
  extra?: Record<string, string>;
}

const MAX_OPS = 500;
/** Items in one request. */
const BATCH = 100;

export const simklQueueKey = (space: string | null) => `polar.simkl.queue.${space ?? "local"}`;

function readIds(v: unknown): SimklIds | undefined {
  if (!isRecord(v)) return undefined;
  const imdb = str(v.imdb);
  if (imdb !== undefined) return /^tt\d{1,10}$/.test(imdb) ? { imdb } : undefined;
  const kitsu = num(v.kitsu);
  return kitsu !== undefined && Number.isInteger(kitsu) && kitsu > 0 ? { kitsu } : undefined;
}

function readRef(v: unknown): SimklRef | undefined {
  if (!isRecord(v)) return undefined;
  const ids = readIds(v.ids);
  if (!ids) return undefined;
  if (v.kind === "movie" || v.kind === "show") return { kind: v.kind, ids };
  const number = num(v.number);
  if (v.kind !== "episode" || number === undefined) return undefined;
  if ("kitsu" in ids) return { kind: "episode", ids, number };
  const season = num(v.season);
  return season === undefined ? undefined : { kind: "episode", ids, season, number };
}

export function readSimklOp(v: unknown): SimklOp | undefined {
  if (!isRecord(v) || (v.list !== "history" && v.list !== "watchlist")) return undefined;
  const ref = readRef(v.ref);
  if (!ref) return undefined;
  const op: SimklOp = { list: v.list, ref };
  if (v.remove === true) op.remove = true;
  if (isRecord(v.extra) && typeof v.extra.watched_at === "string") op.extra = { watched_at: v.extra.watched_at };
  if (isRecord(v.extra) && v.extra.to === "plantowatch") op.extra = { to: "plantowatch" };
  return op;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function pendingSimklOps(space: string | null, storage: Pick<Storage, "getItem"> = localStorage): SimklOp[] {
  const v = storedJson(storage, simklQueueKey(space));
  return Array.isArray(v) ? v.map(readSimklOp).filter((op): op is SimklOp => !!op) : [];
}

function write(space: string | null, ops: SimklOp[], storage: Store) {
  if (ops.length) storeLocal(simklQueueKey(space), JSON.stringify(ops.slice(-MAX_OPS)), storage);
  else storage.removeItem(simklQueueKey(space));
}

/** Adds changes to the profile's queue; each replaces what was still waiting for the same item on the same list. */
export function enqueueSimkl(space: string | null, add: SimklOp[], storage: Store = localStorage) {
  if (!add.length) return;
  let ops = pendingSimklOps(space, storage);
  for (const op of add) ops = ops.filter((o) => !(o.list === op.list && sameSimklRef(o.ref, op.ref)));
  write(space, [...ops, ...add], storage);
}

export function clearSimklQueue(space: string | null, storage: Pick<Storage, "removeItem"> = localStorage) {
  storage.removeItem(simklQueueKey(space));
}

export interface SimklQueueDeps {
  storage: Store;
  liveLink: (space: string | null, renew: boolean) => Promise<SimklLink | undefined>;
  saveLink: (space: string | null, link: SimklLink) => Promise<void>;
  send: (path: string, body: unknown, caller: SimklCaller) => Promise<unknown>;
}

const realDeps = (): SimklQueueDeps => ({
  storage: localStorage,
  liveLink: liveSimklLink,
  saveLink: saveSimklLink,
  send: (path, body, caller) => simkl("POST", path, body, caller),
});

export type SimklFlushResult = "done" | "empty" | "signed-out" | "offline";

/** Where a batch goes: the history, or a list; a title leaves Simkl's lists by leaving its history. */
const pathOf = (list: SimklListName, remove: boolean) => (remove ? "/sync/history/remove" : list === "history" ? "/sync/history" : "/sync/add-to-list");

/** The first run of ops that go out as one request: same list, same direction, at most {@link BATCH}. */
function batchOf(ops: SimklOp[]): SimklOp[] {
  const [first] = ops;
  let n = 1;
  while (n < ops.length && n < BATCH && ops[n].list === first.list && !!ops[n].remove === !!first.remove) n++;
  return ops.slice(0, n);
}

/**
 * Sends the profile's queue in order. A network failure, a busy Simkl or a spent daily allowance
 * keeps the rest for the next try; a refused token is refreshed once, else the link is marked
 * refused and everything waits for a new sign-in; a change Simkl rejects for itself is dropped so
 * it can't hold up the rest. Items Simkl doesn't know (its `not_found`) are dropped too.
 */
export async function flushSimkl(space: string | null, deps: SimklQueueDeps = realDeps()): Promise<SimklFlushResult> {
  let ops = pendingSimklOps(space, deps.storage);
  if (!ops.length) return "empty";
  let link = await deps.liveLink(space, false).catch(() => null);
  if (link === null) return "offline";
  if (!link) return "signed-out";
  let renewed = false;
  while (ops.length) {
    const batch = batchOf(ops);
    const { list, remove } = batch[0];
    try {
      const items: SimklSyncItem[] = batch.map((o) => ({ ref: o.ref, extra: remove ? undefined : o.extra }));
      await deps.send(pathOf(list, !!remove), simklSyncBody(items), { token: link.token });
    } catch (e) {
      if (e instanceof SimklSignedOut) {
        const fresh = renewed ? undefined : await deps.liveLink(space, true).catch(() => null);
        if (fresh === null) return "offline";
        renewed = true;
        if (fresh) {
          link = fresh;
          continue;
        }
        await deps.saveLink(space, { ...link, refused: true });
        return "signed-out";
      }
      if (simklOffline(e)) return "offline";
      console.warn("Simkl: a change was refused and dropped", e instanceof SimklError ? e.status : "");
    }
    // Whatever was queued meanwhile stays, after these.
    const sent = new Set(batch.map((o) => JSON.stringify(o)));
    ops = pendingSimklOps(space, deps.storage).filter((o) => !sent.delete(JSON.stringify(o)));
    write(space, ops, deps.storage);
  }
  return "done";
}
