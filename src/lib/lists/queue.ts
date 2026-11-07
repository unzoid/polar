import { storeLocal } from "../errors";
import { isRecord, num, storedJson } from "../parse";
import { deleteEntry, entryFor, ListError, saveEntry, SignedOut, type Caller, type EntryChange, type ListEntry, type ListStatus } from "./anilistList";
import { afterWatching } from "./progressRule";
import { getLink, saveLink, usable, type Link } from "./linkStore";

/**
 * What a profile still has to tell AniList (#83), kept on the device so a change made offline,
 * or while AniList is busy, goes out later. Per profile, in order; only ids and numbers, never
 * the token. An episode watched is sent as "watched episode n of m": the entry is read when it
 * goes out, so the rule (lib/lists/progressRule.ts) sees what AniList has then.
 */
export type ListOp =
  | { kind: "watched"; mediaId: number; episode: number; total: number | null }
  | { kind: "set"; mediaId: number; change: EntryChange }
  | { kind: "remove"; mediaId: number };

const MAX_OPS = 200;

export const queueKey = (space: string | null) => `polar.lists.queue.anilist.${space ?? "local"}`;

export function readOp(v: unknown): ListOp | undefined {
  if (!isRecord(v)) return undefined;
  const mediaId = num(v.mediaId);
  if (mediaId === undefined || mediaId <= 0) return undefined;
  if (v.kind === "watched") {
    const episode = num(v.episode);
    if (episode === undefined) return undefined;
    return { kind: "watched", mediaId, episode, total: num(v.total) ?? null };
  }
  if (v.kind === "remove") return { kind: "remove", mediaId };
  if (v.kind === "set" && isRecord(v.change)) {
    const c = v.change;
    const change: EntryChange = {};
    if (typeof c.status === "string") change.status = c.status as ListStatus;
    for (const k of ["progress", "score", "repeat"] as const) if (num(c[k]) !== undefined) change[k] = num(c[k]);
    return { kind: "set", mediaId, change };
  }
  return undefined;
}

export interface QueueDeps {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now: () => number;
  getLink: (space: string | null) => Promise<Link | undefined>;
  saveLink: (space: string | null, link: Link) => Promise<void>;
  entryFor: (userId: number, mediaId: number, caller: Caller) => Promise<ListEntry | null>;
  saveEntry: (mediaId: number, change: EntryChange, caller: Caller) => Promise<ListEntry>;
  deleteEntry: (entryId: number, caller: Caller) => Promise<void>;
}

const realDeps = (): QueueDeps => ({
  storage: localStorage,
  now: Date.now,
  getLink: (space) => getLink("anilist", space),
  saveLink: (space, link) => saveLink("anilist", space, link),
  entryFor,
  saveEntry,
  deleteEntry,
});

export function pendingOps(space: string | null, storage: Pick<Storage, "getItem"> = localStorage): ListOp[] {
  const v = storedJson(storage, queueKey(space));
  return Array.isArray(v) ? v.map(readOp).filter((op): op is ListOp => !!op) : [];
}

function write(space: string | null, ops: ListOp[], storage: QueueDeps["storage"]) {
  if (ops.length) storeLocal(queueKey(space), JSON.stringify(ops.slice(-MAX_OPS)), storage);
  else storage.removeItem(queueKey(space));
}

/**
 * Adds `op` to the profile's queue. A change to an entry replaces the entry's earlier changes
 * that it covers: a second "watched" keeps the later episode, a removal drops what came before.
 */
export function enqueue(space: string | null, op: ListOp, storage: QueueDeps["storage"] = localStorage) {
  let ops = pendingOps(space, storage);
  if (op.kind === "remove") ops = ops.filter((o) => o.mediaId !== op.mediaId);
  if (op.kind === "watched") ops = ops.filter((o) => !(o.kind === "watched" && o.mediaId === op.mediaId && o.episode <= op.episode));
  write(space, [...ops, op], storage);
}

/** Drops the profile's queue (unlinking). */
export function clearQueue(space: string | null, storage: Pick<Storage, "removeItem"> = localStorage) {
  storage.removeItem(queueKey(space));
}

export type FlushResult = "done" | "empty" | "signed-out" | "offline";

/**
 * Sends the profile's queue in order. A network failure or a busy AniList keeps the rest for the
 * next try; a refused token marks the link refused and keeps everything until the profile signs
 * in again; a change AniList rejects for itself is dropped so it can't hold up the rest.
 */
export async function flush(space: string | null, deps: QueueDeps = realDeps()): Promise<FlushResult> {
  let ops = pendingOps(space, deps.storage);
  if (!ops.length) return "empty";
  const link = await deps.getLink(space);
  if (!usable(link, deps.now())) return "signed-out";
  const caller: Caller = { token: link.token };
  while (ops.length) {
    const op = ops[0];
    try {
      await send(op, link.userId, caller, deps);
    } catch (e) {
      if (e instanceof SignedOut) {
        await deps.saveLink(space, { ...link, refused: true });
        return "signed-out";
      }
      if (offline(e)) return "offline";
      console.warn("AniList: a list change was refused and dropped");
    }
    // Whatever was queued meanwhile stays, after this one.
    ops = pendingOps(space, deps.storage);
    const i = ops.findIndex((o) => JSON.stringify(o) === JSON.stringify(op));
    if (i >= 0) ops.splice(i, 1);
    write(space, ops, deps.storage);
  }
  return "done";
}

async function send(op: ListOp, userId: number, caller: Caller, deps: QueueDeps) {
  if (op.kind === "set") {
    await deps.saveEntry(op.mediaId, op.change, caller);
    return;
  }
  const entry = await deps.entryFor(userId, op.mediaId, caller);
  if (op.kind === "remove") {
    if (entry) await deps.deleteEntry(entry.id, caller);
    return;
  }
  const change = afterWatching(entry, op.episode, op.total);
  if (change) await deps.saveEntry(op.mediaId, change, caller);
}

/** A failure worth trying again later: no network, or AniList still busy after its wait. */
function offline(e: unknown): boolean {
  if (e instanceof TypeError) return true; // fetch's network failure
  return e instanceof ListError && (e.status === 429 || e.status >= 500);
}
