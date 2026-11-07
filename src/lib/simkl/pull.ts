import { storeLocal } from "../errors";
import { formatVideoId } from "../library/identity";
import { isRecord, num, str, storedJson } from "../parse";
import type { ContentType, LibraryItem, Progress } from "../types";
import { simkl, simklQuotaLow, type SimklCaller } from "./api";
import { polarityIdOf, positiveId as positive, SIMKL_KINDS, SIMKL_STATUSES as STATUSES, type SimklKind, type SimklStatus } from "./items";
import type { SimklLink } from "./link";
import { forgetSimklRatings, pullSimklRatings, simklRatings } from "./ratings";

/**
 * What changed on Simkl since this device last looked (#86), the way Simkl asks apps to sync
 * (api.simkl.org/guides/sync.md): `/sync/activities` first, one cheap read, and only the kinds that
 * moved after it, read with `date_from` set to the last look's `all` exactly as Simkl gave it.
 * Films and episodes watched there come into Polarity's progress as watched; with the watchlist
 * switch on, titles put on Simkl's Plan to Watch come into the library. Both go through the
 * library import (api.importLibrary), which only adds: what Polarity has already, or newer, stays.
 *
 * The first look reads the profile's lists whole, without episodes, only to learn where each
 * title is on Simkl ({@link SimklItems}); what was there before is the import's. What Simkl removes
 * is noticed by its `removed_from_list` time moving, and then only by reading the kind's list as
 * bare Simkl ids: those gone leave the kept lists, and nothing in Polarity is taken away.
 * Ratings are read whole on the first look, and after it only for the kinds whose `rated_at`
 * moved, as what changed since the last look (ratings.ts).
 * Nothing is read while Simkl says the account's daily allowance is nearly spent (api.ts).
 */
/** Where Simkl was at the last look: its `all`, and per kind the time of the last list change, the last removal and the last rating. */
export interface SimklSeen {
  all: string;
  kinds: Partial<Record<SimklKind, { lists: string; removed: string; rated: string }>>;
}

/** A title on the profile's Simkl lists, by Polarity id: its kind there, its list, Simkl's number when known. */
export interface SimklItem {
  kind: SimklKind;
  status: SimklStatus;
  simkl?: number;
}

export type SimklItems = Record<string, SimklItem>;

export const simklSeenKey = (space: string | null) => `polar.simkl.seen.${space ?? "local"}`;
export const simklItemsKey = (space: string | null) => `polar.simkl.items.${space ?? "local"}`;

/** Activities' own name for each kind (`tv_shows`, where the paths say `shows`). */
const ACTIVITY: Record<SimklKind, string> = { shows: "tv_shows", movies: "movies", anime: "anime" };

const latest = (times: (string | undefined)[]) => times.reduce<string>((a, b) => ((Date.parse(b ?? "") || 0) > (Date.parse(a) || 0) ? (b ?? "") : a), "");

/** Where Simkl is, from a `/sync/activities` answer; `undefined` when it isn't one. */
export function readActivities(v: unknown): SimklSeen | undefined {
  if (!isRecord(v)) return undefined;
  const all = str(v.all);
  if (!all) return undefined;
  const kinds: SimklSeen["kinds"] = {};
  for (const kind of SIMKL_KINDS) {
    const k = v[ACTIVITY[kind]];
    if (!isRecord(k)) continue;
    kinds[kind] = { lists: latest(STATUSES.map((s) => str(k[s]))), removed: str(k.removed_from_list) ?? "", rated: str(k.rated_at) ?? "" };
  }
  return { all, kinds };
}

export function readSeen(v: unknown): SimklSeen | undefined {
  if (!isRecord(v) || !str(v.all)) return undefined;
  const kinds: SimklSeen["kinds"] = {};
  if (isRecord(v.kinds))
    for (const kind of SIMKL_KINDS) {
      const k = v.kinds[kind];
      if (isRecord(k)) kinds[kind] = { lists: str(k.lists) ?? "", removed: str(k.removed) ?? "", rated: str(k.rated) ?? "" };
    }
  return { all: str(v.all) ?? "", kinds };
}

const moved = (now: string | undefined, before: string | undefined) => (Date.parse(now ?? "") || 0) > (Date.parse(before ?? "") || 0);

export function readItems(v: unknown): SimklItems {
  const items: SimklItems = {};
  if (!isRecord(v)) return items;
  for (const [id, item] of Object.entries(v)) {
    if (!isRecord(item) || !SIMKL_KINDS.includes(item.kind as SimklKind) || !STATUSES.includes(item.status as SimklStatus)) continue;
    const kept: SimklItem = { kind: item.kind as SimklKind, status: item.status as SimklStatus };
    const n = num(item.simkl);
    if (n !== undefined) kept.simkl = n;
    items[id] = kept;
  }
  return items;
}

/** The titles on the profile's Simkl lists as the last look left them. */
export const simklItems = (space: string | null, storage: Pick<Storage, "getItem"> = localStorage): SimklItems =>
  readItems(storedJson(storage, simklItemsKey(space)));

const itemListeners = new Set<() => void>();

/** Hear when the kept lists change; returns the function that stops listening. */
export function onSimklItems(listener: () => void): () => void {
  itemListeners.add(listener);
  return () => itemListeners.delete(listener);
}

function keepItems(space: string | null, items: SimklItems, storage: Pick<Storage, "setItem">) {
  storeLocal(simklItemsKey(space), JSON.stringify(items), storage);
  itemListeners.forEach((l) => l());
}

/** Notes a change Polarity made itself (a title put on Plan to Watch, or taken off), until the next look says otherwise. */
export function noteSimklItem(space: string | null, id: string, item: SimklItem | null, storage: Pick<Storage, "getItem" | "setItem"> = localStorage) {
  const items = simklItems(space, storage);
  if (item) items[id] = { ...items[id], ...item };
  else delete items[id];
  keepItems(space, items, storage);
}

/** One entry of an all-items answer, read: where it is, and what it is in Polarity. */
export interface SimklEntry {
  id: string;
  type: ContentType;
  name: string;
  item: SimklItem;
  raw: Record<string, unknown>;
}

function readEntry(kind: SimklKind, v: unknown): SimklEntry | undefined {
  if (!isRecord(v)) return undefined;
  const title = isRecord(v.movie) ? v.movie : isRecord(v.show) ? v.show : undefined;
  const status = str(v.status) === "notinteresting" ? "dropped" : str(v.status);
  if (!title || !STATUSES.includes(status as SimklStatus)) return undefined;
  const id = polarityIdOf(kind, title.ids);
  if (!id) return undefined;
  const item: SimklItem = { kind, status: status as SimklStatus };
  const n = isRecord(title.ids) ? positive(title.ids.simkl) : undefined;
  if (n) item.simkl = n;
  const film = kind === "movies" || (kind === "anime" && str(v.anime_type) === "movie");
  return { id, type: film ? "movie" : "series", name: str(title.title) ?? id, item, raw: v };
}

/**
 * The videos of an entry watched after `since`, as Polarity's watched progress: a film by its last
 * watch when finished, episodes by their own `watched_at`. An IMDb show's episodes keep Simkl's
 * seasons; a Kitsu anime's only when Simkl lists them as one season, numbered from the first as
 * Polarity numbers them, and an anime Simkl knows only by IMDb's id not at all.
 */
export function watchedSince(entry: SimklEntry, since: number): Progress[] {
  const { id, type, name, raw } = entry;
  const base = { metaId: id, type, name, position: 1, duration: 1 };
  if (type === "movie") {
    const at = Date.parse(str(raw.last_watched_at) ?? "");
    return entry.item.status === "completed" && at > since ? [{ ...base, videoId: id, updatedAt: at }] : [];
  }
  const seasons = Array.isArray(raw.seasons) ? raw.seasons.filter(isRecord) : [];
  const kitsu = id.startsWith("kitsu:");
  // An anime known only by its IMDb id: Simkl's seasons are the anime sites', not IMDb's.
  if (kitsu ? seasons.length !== 1 : entry.item.kind === "anime") return [];
  const out: Progress[] = [];
  for (const s of seasons) {
    const season = num(s.number);
    if (season === undefined || !Array.isArray(s.episodes)) continue;
    for (const e of s.episodes) {
      if (!isRecord(e)) continue;
      const episode = positive(e.number);
      const at = Date.parse(str(e.watched_at) ?? "");
      if (!episode || !(at > since)) continue;
      const videoId = kitsu ? `${id}:${episode}` : formatVideoId({ title: { kind: "imdb", value: id }, season, episode });
      out.push({ ...base, videoId, updatedAt: at, ...(kitsu ? { episode } : { season, episode }) });
    }
  }
  return out;
}

/** The entries of an all-items answer Polarity can play: those with an IMDb id, or for anime a Kitsu number. */
export const entriesOf = (kind: SimklKind, answer: unknown): SimklEntry[] => {
  const list = isRecord(answer) ? answer[kind] : undefined;
  return Array.isArray(list) ? list.map((v) => readEntry(kind, v)).filter((e): e is SimklEntry => !!e) : [];
};

/** The bare Simkl numbers of a `simkl_ids_only` answer. */
function simklNumbers(kind: SimklKind, answer: unknown): Set<number> {
  const list = isRecord(answer) ? answer[kind] : undefined;
  const out = new Set<number>();
  if (Array.isArray(list))
    for (const v of list) {
      const title = isRecord(v) ? (isRecord(v.movie) ? v.movie : v.show) : undefined;
      const n = isRecord(title) && isRecord(title.ids) ? positive(title.ids.simkl) : undefined;
      if (n) out.add(n);
    }
  return out;
}

export interface SimklPullDeps {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  get: (path: string, query: Record<string, string>, caller: SimklCaller) => Promise<unknown>;
  /** api.importLibrary, then whatever shows the library and progress again. */
  importLibrary: (library: LibraryItem[], progress: Progress[]) => Promise<unknown>;
  quotaLow: () => boolean;
}

export const realSimklPullDeps = (importLibrary: SimklPullDeps["importLibrary"]): SimklPullDeps => ({
  storage: localStorage,
  get: (path, query, caller) => simkl("GET", path, undefined, caller, query),
  importLibrary,
  quotaLow: () => simklQuotaLow(),
});

export interface SimklPullResult {
  /** Watched videos and library titles handed to the import. */
  watched: number;
  listed: number;
}

/**
 * Looks at what changed on Simkl for the profile and brings it in; `null` on the first look, which
 * only learns the lists, and when the day's allowance is nearly spent. Where Simkl was is kept only
 * once every read of the look has gone through, so a failed look is made again whole.
 */
export async function pullSimkl(space: string | null, link: SimklLink, deps: SimklPullDeps): Promise<SimklPullResult | null> {
  if (deps.quotaLow()) return null;
  const caller = { token: link.token };
  const now = readActivities(await deps.get("/sync/activities", {}, caller));
  if (!now) return { watched: 0, listed: 0 };
  const seen = readSeen(storedJson(deps.storage, simklSeenKey(space)));
  const keep = () => storeLocal(simklSeenKey(space), JSON.stringify(now), deps.storage);
  if (!seen) {
    const items: SimklItems = {};
    for (const kind of SIMKL_KINDS) {
      if (deps.quotaLow()) return null;
      for (const e of entriesOf(kind, await deps.get(`/sync/all-items/${kind}`, { extended: "ids_only" }, caller))) items[e.id] = e.item;
    }
    keepItems(space, items, deps.storage);
    if (deps.quotaLow()) return null;
    await pullSimklRatings(space, caller, deps.get, deps.storage);
    keep();
    return null;
  }
  const ratingsRead = simklRatings(space, deps.storage) !== undefined;
  if (now.all === seen.all && ratingsRead) return { watched: 0, listed: 0 };
  const items = simklItems(space, deps.storage);
  const since = Date.parse(seen.all) || 0;
  const progress: Progress[] = [];
  const library: LibraryItem[] = [];
  for (const kind of SIMKL_KINDS) {
    const [was, is] = [seen.kinds[kind], now.kinds[kind]];
    if (moved(is?.removed, was?.removed)) {
      if (deps.quotaLow()) return null;
      const still = simklNumbers(kind, await deps.get(`/sync/all-items/${kind}`, { extended: "simkl_ids_only" }, caller));
      for (const [id, item] of Object.entries(items)) if (item.kind === kind && item.simkl && !still.has(item.simkl)) delete items[id];
    }
    if (!moved(is?.lists, was?.lists)) continue;
    if (deps.quotaLow()) return null;
    const answer = await deps.get(`/sync/all-items/${kind}`, { date_from: seen.all, extended: "full", episode_watched_at: "yes" }, caller);
    for (const e of entriesOf(kind, answer)) {
      const before = items[e.id];
      items[e.id] = e.item;
      progress.push(...watchedSince(e, since));
      if (link.watchlist && e.item.status === "plantowatch" && before?.status !== "plantowatch" && !library.some((l) => l.id === e.id)) {
        const added = Date.parse(str(e.raw.added_to_watchlist_at) ?? "");
        library.push({ id: e.id, type: e.type, name: e.name, addedAt: Number.isFinite(added) ? added : 0 });
      }
    }
  }
  const rated = SIMKL_KINDS.filter((kind) => moved(now.kinds[kind]?.rated, seen.kinds[kind]?.rated));
  if (!ratingsRead || rated.length) {
    if (deps.quotaLow()) return null;
    await pullSimklRatings(space, caller, deps.get, deps.storage, ratingsRead ? { all: seen.all, kinds: rated } : undefined);
  }
  if (progress.length || library.length) await deps.importLibrary(library, progress);
  keepItems(space, items, deps.storage);
  keep();
  return { watched: progress.length, listed: library.length };
}

/** Forgets where Simkl was, and the lists and ratings kept for the profile (unlinking). */
export function forgetSimklSeen(space: string | null, storage: Pick<Storage, "removeItem"> = localStorage) {
  storage.removeItem(simklSeenKey(space));
  storage.removeItem(simklItemsKey(space));
  itemListeners.forEach((l) => l());
  forgetSimklRatings(space, storage);
}
