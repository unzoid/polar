import { storeLocal } from "../errors";
import { isRecord, num, str, storedJson } from "../parse";
import { trakt, TraktError, traktOffline, TraktSignedOut, type TraktCaller } from "./api";
import { saveTraktLink, type TraktLink } from "./link";
import { liveTraktLink } from "./linking";
import { syncBody, type SyncItem, type TraktRef } from "./items";

/**
 * What a profile still has to tell Trakt (#85), kept on the device so a change made offline, or
 * while Trakt is busy, goes out later: watched marks (`history`), the watchlist and ratings, each
 * added or removed. Per profile, in order; only IMDb ids, numbers and times, never the token.
 * Changes next to each other of the same kind go out as one request, which Trakt's limit of one
 * write a second asks for.
 */
export type TraktList = "history" | "watchlist" | "ratings";

export interface TraktOp {
  list: TraktList;
  remove?: true;
  ref: TraktRef;
  /** `watched_at` for history, `rating` (1–10) for ratings. */
  extra?: Record<string, string | number>;
}

const MAX_OPS = 500;
/** Items in one request. */
const BATCH = 100;

export const traktQueueKey = (space: string | null) => `polar.trakt.queue.${space ?? "local"}`;

function readRef(v: unknown): TraktRef | undefined {
  if (!isRecord(v)) return undefined;
  const imdb = str(v.imdb);
  if (!imdb || !/^tt\d{1,10}$/.test(imdb)) return undefined;
  if (v.kind === "movie" || v.kind === "show") return { kind: v.kind, imdb };
  const [season, number] = [num(v.season), num(v.number)];
  if (v.kind === "episode" && season !== undefined && number !== undefined) return { kind: "episode", imdb, season, number };
  return undefined;
}

export function readTraktOp(v: unknown): TraktOp | undefined {
  if (!isRecord(v) || (v.list !== "history" && v.list !== "watchlist" && v.list !== "ratings")) return undefined;
  const ref = readRef(v.ref);
  if (!ref) return undefined;
  const op: TraktOp = { list: v.list, ref };
  if (v.remove === true) op.remove = true;
  if (isRecord(v.extra)) {
    const extra: Record<string, string | number> = {};
    for (const [k, x] of Object.entries(v.extra)) if ((k === "watched_at" && typeof x === "string") || (k === "rating" && typeof x === "number")) extra[k] = x;
    if (Object.keys(extra).length) op.extra = extra;
  }
  return op;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function pendingTraktOps(space: string | null, storage: Pick<Storage, "getItem"> = localStorage): TraktOp[] {
  const v = storedJson(storage, traktQueueKey(space));
  return Array.isArray(v) ? v.map(readTraktOp).filter((op): op is TraktOp => !!op) : [];
}

function write(space: string | null, ops: TraktOp[], storage: Store) {
  if (ops.length) storeLocal(traktQueueKey(space), JSON.stringify(ops.slice(-MAX_OPS)), storage);
  else storage.removeItem(traktQueueKey(space));
}

const sameRef = (a: TraktRef, b: TraktRef) =>
  a.kind === b.kind && a.imdb === b.imdb && (a.kind !== "episode" || (b.kind === "episode" && a.season === b.season && a.number === b.number));

/** Adds changes to the profile's queue; each replaces what was still waiting for the same item on the same list. */
export function enqueueTrakt(space: string | null, add: TraktOp[], storage: Store = localStorage) {
  if (!add.length) return;
  let ops = pendingTraktOps(space, storage);
  for (const op of add) ops = ops.filter((o) => !(o.list === op.list && sameRef(o.ref, op.ref)));
  write(space, [...ops, ...add], storage);
}

export function clearTraktQueue(space: string | null, storage: Pick<Storage, "removeItem"> = localStorage) {
  storage.removeItem(traktQueueKey(space));
}

export interface TraktQueueDeps {
  storage: Store;
  liveLink: (space: string | null, renew: boolean) => Promise<TraktLink | undefined>;
  saveLink: (space: string | null, link: TraktLink) => Promise<void>;
  send: (path: string, body: unknown, caller: TraktCaller) => Promise<unknown>;
  /** A change Trakt refused because a free account's list is full (420). */
  full: (list: TraktList) => void;
}

const fullListeners = new Set<(list: TraktList) => void>();

/** Hear when Trakt refuses a change because the account's list is full; returns the function that stops listening. */
export function onTraktFull(listener: (list: TraktList) => void): () => void {
  fullListeners.add(listener);
  return () => fullListeners.delete(listener);
}

const realDeps = (): TraktQueueDeps => ({
  storage: localStorage,
  liveLink: liveTraktLink,
  saveLink: saveTraktLink,
  send: (path, body, caller) => trakt("POST", path, body, caller),
  full: (list) => fullListeners.forEach((l) => l(list)),
});

export type TraktFlushResult = "done" | "empty" | "signed-out" | "offline";

/** The first run of ops that go out as one request: same list, same direction, at most {@link BATCH}. */
function batchOf(ops: TraktOp[]): TraktOp[] {
  const [first] = ops;
  let n = 1;
  while (n < ops.length && n < BATCH && ops[n].list === first.list && !!ops[n].remove === !!first.remove) n++;
  return ops.slice(0, n);
}

/**
 * Sends the profile's queue in order. A network failure or a busy Trakt keeps the rest for the
 * next try; a refused token is refreshed once, else the link is marked refused and everything
 * waits for a new sign-in; a change Trakt rejects for itself is dropped so it can't hold up the rest.
 */
export async function flushTrakt(space: string | null, deps: TraktQueueDeps = realDeps()): Promise<TraktFlushResult> {
  let ops = pendingTraktOps(space, deps.storage);
  if (!ops.length) return "empty";
  let link = await deps.liveLink(space, false).catch(() => null);
  if (link === null) return "offline";
  if (!link) return "signed-out";
  let renewed = false;
  while (ops.length) {
    const batch = batchOf(ops);
    const { list, remove } = batch[0];
    try {
      const items: SyncItem[] = batch.map((o) => ({ ref: o.ref, extra: remove ? undefined : o.extra }));
      await deps.send(`/sync/${list}${remove ? "/remove" : ""}`, syncBody(items), { token: link.token });
    } catch (e) {
      if (e instanceof TraktSignedOut) {
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
      if (traktOffline(e)) return "offline";
      if (e instanceof TraktError && e.status === 420) deps.full(list);
      else console.warn("Trakt: a change was refused and dropped");
    }
    // Whatever was queued meanwhile stays, after these.
    const sent = new Set(batch.map((o) => JSON.stringify(o)));
    ops = pendingTraktOps(space, deps.storage).filter((o) => !sent.delete(JSON.stringify(o)));
    write(space, ops, deps.storage);
  }
  return "done";
}
