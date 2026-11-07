import { storeLocal } from "../errors";
import { isRecord, num, storedJson } from "../parse";
import { ListError, SignedOut, type Caller, type EntryChange, type ListStatus } from "./entry";
import { saveLink, type Link, type ListService } from "./linkStore";
import { afterWatching } from "./progressRule";
import { listClient, liveLink, type ListClient } from "./services";

/**
 * What a profile still has to tell a linked list service (#83, #84), kept on the device so a
 * change made offline, or while the service is busy, goes out later. Per service and profile, in
 * order; only the service's ids and numbers, never the token. An episode watched is sent as
 * "watched episode n of m": the entry is read when it goes out, so the rule
 * (lib/lists/progressRule.ts) sees what the service has then.
 */
export type ListOp =
  | { kind: "watched"; mediaId: number; episode: number; total: number | null }
  | { kind: "set"; mediaId: number; change: EntryChange }
  | { kind: "remove"; mediaId: number };

const MAX_OPS = 200;

export const queueKey = (service: ListService, space: string | null) => `polar.lists.queue.${service}.${space ?? "local"}`;

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
  /** The profile's link, ready to use; with `renew`, refreshed because the service just refused it (services.ts). */
  liveLink: (space: string | null, renew: boolean) => Promise<Link | undefined>;
  saveLink: (space: string | null, link: Link) => Promise<void>;
  client: Pick<ListClient, "entryFor" | "saveEntry" | "deleteEntry" | "name">;
}

const realDeps = (service: ListService): QueueDeps => ({
  storage: localStorage,
  liveLink: (space, renew) => liveLink(service, space, renew),
  saveLink: (space, link) => saveLink(service, space, link),
  client: listClient(service),
});

export function pendingOps(service: ListService, space: string | null, storage: Pick<Storage, "getItem"> = localStorage): ListOp[] {
  const v = storedJson(storage, queueKey(service, space));
  return Array.isArray(v) ? v.map(readOp).filter((op): op is ListOp => !!op) : [];
}

function write(service: ListService, space: string | null, ops: ListOp[], storage: QueueDeps["storage"]) {
  if (ops.length) storeLocal(queueKey(service, space), JSON.stringify(ops.slice(-MAX_OPS)), storage);
  else storage.removeItem(queueKey(service, space));
}

/**
 * Adds `op` to the profile's queue. A change to an entry replaces the entry's earlier changes
 * that it covers: a second "watched" keeps the later episode, a removal drops what came before,
 * and changes made one after another (the page's episode buttons) go out as one.
 */
export function enqueue(service: ListService, space: string | null, op: ListOp, storage: QueueDeps["storage"] = localStorage) {
  let ops = pendingOps(service, space, storage);
  if (op.kind === "remove") ops = ops.filter((o) => o.mediaId !== op.mediaId);
  if (op.kind === "watched") ops = ops.filter((o) => !(o.kind === "watched" && o.mediaId === op.mediaId && o.episode <= op.episode));
  const last = ops.at(-1);
  if (op.kind === "set" && last?.kind === "set" && last.mediaId === op.mediaId) {
    write(service, space, [...ops.slice(0, -1), { ...op, change: { ...last.change, ...op.change } }], storage);
    return;
  }
  write(service, space, [...ops, op], storage);
}

/** Drops the profile's queue (unlinking). */
export function clearQueue(service: ListService, space: string | null, storage: Pick<Storage, "removeItem"> = localStorage) {
  storage.removeItem(queueKey(service, space));
}

export type FlushResult = "done" | "empty" | "signed-out" | "offline";

/**
 * Sends the profile's queue for `service` in order. A network failure or a busy service keeps the
 * rest for the next try; a refused token is refreshed once where the service allows it, else the
 * link is marked refused and everything waits until the profile signs in again; a change the
 * service rejects for itself is dropped so it can't hold up the rest.
 */
export async function flush(service: ListService, space: string | null, deps: QueueDeps = realDeps(service)): Promise<FlushResult> {
  let ops = pendingOps(service, space, deps.storage);
  if (!ops.length) return "empty";
  let link = await deps.liveLink(space, false).catch(() => null);
  if (link === null) return "offline";
  if (!link) return "signed-out";
  let renewed = false;
  while (ops.length) {
    const op = ops[0];
    try {
      await send(op, link.userId, { token: link.token }, deps.client);
    } catch (e) {
      if (e instanceof SignedOut) {
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
      if (offline(e)) return "offline";
      console.warn(`${deps.client.name}: a list change was refused and dropped`);
    }
    // Whatever was queued meanwhile stays, after this one.
    ops = pendingOps(service, space, deps.storage);
    const i = ops.findIndex((o) => JSON.stringify(o) === JSON.stringify(op));
    if (i >= 0) ops.splice(i, 1);
    write(service, space, ops, deps.storage);
  }
  return "done";
}

async function send(op: ListOp, userId: number, caller: Caller, client: QueueDeps["client"]) {
  if (op.kind === "set") {
    await client.saveEntry(op.mediaId, op.change, caller);
    return;
  }
  const entry = await client.entryFor(userId, op.mediaId, caller);
  if (op.kind === "remove") {
    if (entry) await client.deleteEntry(entry.id, caller);
    return;
  }
  const change = afterWatching(entry, op.episode, op.total);
  if (change) await client.saveEntry(op.mediaId, change, caller);
}

/** A failure worth trying again later: no network, or the service still busy after its wait. */
function offline(e: unknown): boolean {
  if (e instanceof TypeError) return true; // fetch's network failure
  return e instanceof ListError && (e.status === 429 || e.status >= 500);
}
