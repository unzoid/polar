import { isRecord, listOf, num, str } from "../parse";
import type { LibraryItem, Progress } from "../types";
import { trakt, type TraktCaller } from "./api";
import { readTraktItem } from "./items";
import { watchlistItem } from "./pull";

/**
 * Importing a linked Trakt account (#85) into the profile's library: optional, run from Settings →
 * Services → Trakt when the user asks, as often as they like. The watchlist's films and shows
 * become library items, and every film and episode watched on Trakt becomes a watched mark, at
 * the time Trakt last saw it watched. Everything goes by its IMDb id, as Polarity plays it;
 * what Trakt has no IMDb id for is counted and left out. The library import (api.importLibrary)
 * only adds: what is already there, or newer, stays as it is, and nothing is removed.
 *
 * The pull (pull.ts) follows changes after linking; this reads the whole account once.
 */

export interface TraktImportPreview {
  library: LibraryItem[];
  progress: Progress[];
  /** Watchlist films and shows, watched films, and the shows of the watched episodes. */
  listedFilms: number;
  listedShows: number;
  watchedFilms: number;
  watchedEpisodes: number;
  /** Watchlist or watched items without an IMDb id: Polarity has nothing to play them from. */
  unlinked: number;
}

export interface TraktImportChoice {
  library: boolean;
  watched: boolean;
}

/** At most this many watchlist pages of 100 (a free account holds far fewer). */
const WATCHLIST_PAGES = 50;

const imdbOf = (o: unknown) => readTraktItem({ type: "movie", movie: o })?.imdb;

/** One `/sync/watched/movies` item as a watched film; `undefined` without an IMDb id or a time. */
export function watchedFilm(v: unknown): Progress | undefined {
  if (!isRecord(v)) return undefined;
  const imdb = imdbOf(v.movie);
  const at = Date.parse(str(v.last_watched_at) ?? "");
  if (!imdb || !Number.isFinite(at)) return undefined;
  const name = (isRecord(v.movie) && str(v.movie.title)) || imdb;
  return { metaId: imdb, videoId: imdb, type: "movie", name, position: 1, duration: 1, updatedAt: at };
}

/** One `/sync/watched/shows` item as its watched episodes; none without an IMDb id. Specials are season 0, as Trakt has them. */
export function watchedEpisodes(v: unknown): Progress[] {
  if (!isRecord(v)) return [];
  const imdb = imdbOf(v.show);
  if (!imdb) return [];
  const name = (isRecord(v.show) && str(v.show.title)) || imdb;
  const showAt = Date.parse(str(v.last_watched_at) ?? "");
  const rows: Progress[] = [];
  for (const s of Array.isArray(v.seasons) ? v.seasons : []) {
    const season = isRecord(s) ? num(s.number) : undefined;
    if (season === undefined || season < 0 || !isRecord(s) || !Array.isArray(s.episodes)) continue;
    for (const e of s.episodes) {
      const episode = isRecord(e) ? num(e.number) : undefined;
      if (episode === undefined || episode < 1 || !isRecord(e)) continue;
      const at = Date.parse(str(e.last_watched_at) ?? "");
      const updatedAt = Number.isFinite(at) ? at : showAt;
      if (!Number.isFinite(updatedAt)) continue;
      rows.push({ metaId: imdb, videoId: `${imdb}:${season}:${episode}`, type: "series", name, season, episode, position: 1, duration: 1, updatedAt });
    }
  }
  return rows;
}

const counted = (items: unknown) => (Array.isArray(items) ? items.length : 0);

export interface TraktImportDeps {
  get: (path: string, caller: TraktCaller) => Promise<unknown>;
}

export const realTraktImportDeps = (): TraktImportDeps => ({ get: (path, caller) => trakt("GET", path, undefined, caller) });

/** Reads the account's watchlist and everything watched, and says what an import would bring in. */
export async function readTraktImport(token: string, deps: TraktImportDeps = realTraktImportDeps()): Promise<TraktImportPreview> {
  const caller: TraktCaller = { token };
  const library = new Map<string, LibraryItem>();
  let unlinked = 0;
  for (let page = 1; page <= WATCHLIST_PAGES; page++) {
    const items = await deps.get(`/sync/watchlist?sort_by=added&sort_how=asc&page=${page}&limit=100`, caller);
    const listed = listOf(items, watchlistItem);
    unlinked += counted(items) - listed.length;
    // A season or an episode on the watchlist stands for its show; the earliest time it was listed counts.
    for (const item of listed) if (!library.has(item.id) || item.addedAt < library.get(item.id)!.addedAt) library.set(item.id, item);
    if (counted(items) < 100) break;
  }
  const films = await deps.get("/sync/watched/movies", caller);
  const shows = await deps.get("/sync/watched/shows", caller);
  const filmRows = listOf(films, watchedFilm);
  const showList: unknown[] = Array.isArray(shows) ? shows : [];
  unlinked += counted(films) - filmRows.length + showList.filter((s) => !isRecord(s) || !imdbOf(s.show)).length;
  const progress = [...filmRows, ...showList.flatMap(watchedEpisodes)];
  const items = [...library.values()];
  return {
    library: items,
    progress,
    listedFilms: items.filter((i) => i.type === "movie").length,
    listedShows: items.filter((i) => i.type !== "movie").length,
    watchedFilms: filmRows.length,
    watchedEpisodes: progress.length - filmRows.length,
    unlinked,
  };
}

/** What the import hands to api.importLibrary for the user's choice. */
export function planTraktImport(p: TraktImportPreview, choice: TraktImportChoice): { library: LibraryItem[]; progress: Progress[] } {
  return { library: choice.library ? p.library : [], progress: choice.watched ? p.progress : [] };
}
