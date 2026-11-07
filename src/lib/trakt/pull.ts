import { storeLocal } from "../errors";
import { isRecord, listOf, str, storedJson } from "../parse";
import type { LibraryItem, Progress } from "../types";
import { trakt, type TraktCaller } from "./api";
import { readTraktItem, videoIdOf, type TraktRef } from "./items";
import type { TraktLink } from "./link";
import { pullRatings, traktRatings } from "./ratings";

/**
 * What changed on Trakt since this device last looked (#85): Trakt's `last_activities` first, one
 * cheap read, and only what moved after it. Films and episodes watched there come into Polarity's
 * progress as watched; with the watchlist switch on, titles put on the watchlist there come into
 * the library. Both go through the library import (api.importLibrary), which only adds: what
 * Polarity has already, or newer, stays, and nothing goes back to Trakt.
 *
 * The first look after linking only notes where Trakt is: what was there before is the import's.
 * What Trakt removes (a play taken off its history, a title off its watchlist) isn't followed.
 * Film and show ratings are read whole whenever they moved, the first look too (ratings.ts).
 */
export interface TraktSeen {
  /** Trakt's own times (ISO) of the last watched mark and the last watchlist change. */
  watched: string;
  watchlist: string;
  /** The last film or show rating. */
  rated: string;
}

export const traktSeenKey = (space: string | null) => `polar.trakt.seen.${space ?? "local"}`;

/** At most this many history pages of 100 a look; anything older is the import's. */
const HISTORY_PAGES = 5;

const later = (a: string | undefined, b: string | undefined) => ((Date.parse(a ?? "") || 0) >= (Date.parse(b ?? "") || 0) ? (a ?? "") : (b ?? ""));

/** The two times Polarity follows, from a `/sync/last_activities` answer. */
export function readActivities(v: unknown): TraktSeen | undefined {
  if (!isRecord(v)) return undefined;
  const at = (kind: string, field: string) => {
    const k = v[kind];
    return isRecord(k) ? str(k[field]) : undefined;
  };
  const watched = later(at("movies", "watched_at"), at("episodes", "watched_at"));
  const watchlist = later(later(at("movies", "watchlisted_at"), at("shows", "watchlisted_at")), at("episodes", "watchlisted_at"));
  const rated = later(at("movies", "rated_at"), at("shows", "rated_at"));
  if (!watched && !watchlist && !rated && !str(v.all)) return undefined;
  return { watched, watchlist, rated };
}

export function readSeen(v: unknown): TraktSeen | undefined {
  if (!isRecord(v)) return undefined;
  return { watched: str(v.watched) ?? "", watchlist: str(v.watchlist) ?? "", rated: str(v.rated) ?? "" };
}

const moved = (now: string, before: string) => (Date.parse(now) || 0) > (Date.parse(before) || 0);

const nameOf = (v: Record<string, unknown>, kind: "movie" | "show") => {
  const o = v[kind];
  return isRecord(o) ? str(o.title) : undefined;
};

/** A history item as a watched Polarity video; `undefined` without an IMDb id or a time. */
export function historyRow(v: unknown): Progress | undefined {
  if (!isRecord(v)) return undefined;
  const ref = readTraktItem(v);
  const at = Date.parse(str(v.watched_at) ?? "");
  if (!ref || ref.kind === "show" || !Number.isFinite(at)) return undefined;
  const base = { metaId: ref.imdb, videoId: videoIdOf(ref), position: 1, duration: 1, updatedAt: at };
  if (ref.kind === "movie") return { ...base, type: "movie", name: nameOf(v, "movie") ?? ref.imdb };
  const episode = isRecord(v.episode) ? v.episode : {};
  return { ...base, type: "series", name: nameOf(v, "show") ?? ref.imdb, season: ref.season, episode: ref.number, episodeTitle: str(episode.title) };
}

/** A watchlist item as a library item; episodes and seasons on the watchlist stand for their show. */
export function watchlistItem(v: unknown): LibraryItem | undefined {
  if (!isRecord(v)) return undefined;
  const type = str(v.type);
  const listed = Date.parse(str(v.listed_at) ?? "");
  if (!Number.isFinite(listed)) return undefined;
  let ref: TraktRef | undefined;
  if (type === "season" || type === "episode") ref = readTraktItem({ type: "show", show: v.show });
  else ref = readTraktItem(v);
  if (!ref) return undefined;
  if (ref.kind === "movie") return { id: ref.imdb, type: "movie", name: nameOf(v, "movie") ?? ref.imdb, addedAt: listed };
  return { id: ref.imdb, type: "series", name: nameOf(v, "show") ?? ref.imdb, addedAt: listed };
}

export interface PullDeps {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  get: (path: string, caller: TraktCaller) => Promise<unknown>;
  /** api.importLibrary, then whatever shows the library and progress again. */
  importLibrary: (library: LibraryItem[], progress: Progress[]) => Promise<unknown>;
}

export const realPullDeps = (importLibrary: PullDeps["importLibrary"]): PullDeps => ({
  storage: localStorage,
  get: (path, caller) => trakt("GET", path, undefined, caller),
  importLibrary,
});

export interface PullResult {
  /** Watched videos and library titles handed to the import. */
  watched: number;
  listed: number;
}

/** Looks at what changed on Trakt for the profile and brings it in; `null` on the first look, which only notes where Trakt is. */
export async function pullTrakt(space: string | null, link: TraktLink, deps: PullDeps): Promise<PullResult | null> {
  const caller = { token: link.token };
  const now = readActivities(await deps.get("/sync/last_activities", caller));
  if (!now) return { watched: 0, listed: 0 };
  const seen = readSeen(storedJson(deps.storage, traktSeenKey(space)));
  const keep = (s: TraktSeen) => storeLocal(traktSeenKey(space), JSON.stringify(s), deps.storage);
  if (!seen || !traktRatings(space, deps.storage) || moved(now.rated, seen.rated)) await pullRatings(space, caller, deps.get, deps.storage);
  if (!seen) {
    keep(now);
    return null;
  }
  const progress: Progress[] = [];
  const library: LibraryItem[] = [];
  if (moved(now.watched, seen.watched) && seen.watched) {
    for (let page = 1; page <= HISTORY_PAGES; page++) {
      const items = await deps.get(`/sync/history?start_at=${encodeURIComponent(seen.watched)}&page=${page}&limit=100`, caller);
      const rows = listOf(items, historyRow);
      progress.push(...rows);
      if (!Array.isArray(items) || items.length < 100) break;
    }
  }
  if (link.watchlist && moved(now.watchlist, seen.watchlist)) {
    const since = Date.parse(seen.watchlist) || 0;
    const items = await deps.get("/sync/watchlist?sort_by=added&sort_how=desc&limit=100&page=1", caller);
    for (const item of listOf(items, watchlistItem)) if (item.addedAt > since && !library.some((l) => l.id === item.id)) library.push(item);
  }
  if (progress.length || library.length) await deps.importLibrary(library, progress);
  keep({ watched: now.watched || seen.watched, watchlist: now.watchlist || seen.watchlist, rated: now.rated || seen.rated });
  return { watched: progress.length, listed: library.length };
}

/** Forgets where Trakt was for the profile (unlinking). */
export function forgetTraktSeen(space: string | null, storage: Pick<Storage, "removeItem"> = localStorage) {
  storage.removeItem(traktSeenKey(space));
}
