import { alignByAirDate, cachedAniZip, matchVideo, regularEpisodes, type AniZip } from "../anime/anizip";
import { animeLinks } from "../anime/links";
import { api } from "../api";
import type { AnimeLink } from "../library/identity";
import { concurrency } from "../net/limiter";
import { call } from "../platform/bridge";
import type { ContentType, LibraryItem, Meta, Progress, Video } from "../types";
import type { ListEntry } from "./anilistList";

/**
 * Importing a linked AniList list into the profile's library (#83): optional, run from Settings
 * when the user asks, as often as they like. Each entry becomes a library item under the id its
 * anime page plays it from (the stored link, else the IMDb show the id lists name, else its Kitsu
 * id), and its progress becomes watched marks for the entry's first episodes. The library import
 * (api.importLibrary) only adds: what is already there, or newer, stays as it is, and nothing is
 * removed. Adult entries are left out unless the AniList account shows them.
 */

/** The ids the anime id lists kept on the device give an AniList entry. */
export interface ListedIds {
  imdb_id?: string | null;
  kitsu_id?: number | null;
}

export interface ListImportDeps {
  /** The space's stored anime links (lib/anime/links.ts). */
  links: () => Promise<AnimeLink[]>;
  /** The anime id lists' ids of an AniList entry; null when it has none. */
  listed: (anilist: number) => Promise<ListedIds | null>;
  /** ani.zip's answer for an AniList entry: its ids when the lists have none, and its episodes. */
  aniZip: (anilist: number) => Promise<AniZip | null>;
  /** A title's metadata (its episodes), null when it can't be read. */
  meta: (type: ContentType, id: string) => Promise<Meta | null>;
  /** How many lookups run at once. */
  run?: <T>(task: () => Promise<T>) => Promise<T>;
  /** After each entry looked at: how many of how many. */
  step?: (done: number, of: number) => void;
}

/** The real lookups: the id lists and links on the device first, ani.zip and metadata four at a time. */
export const listImportDeps = (step?: ListImportDeps["step"]): ListImportDeps => ({
  links: animeLinks,
  listed: (anilist) => call<ListedIds | null>("anime_ids", { key: "anilist_id", value: String(anilist) }),
  aniZip: (anilist) => cachedAniZip({ anilist_id: anilist }),
  meta: (type, id) => api.meta(type, id),
  run: concurrency(4),
  step,
});

export interface ListChoice {
  library: boolean;
  watched: boolean;
}

export interface ListPreview {
  /** The entries the import works on (adult ones left out unless the account shows them). */
  entries: ListEntry[];
  films: number;
  shows: number;
  /** Episodes (and films) the entries' progress marks watched. */
  watched: number;
  /** Adult entries left out. */
  adult: number;
}

export interface ListPlan {
  library: LibraryItem[];
  progress: Progress[];
  /** Entries no id could be found for: Polarity has nothing to play them from. */
  unlinked: number;
  /** Entries whose watched episodes couldn't all be found among the show's episodes. */
  unmatched: number;
}

const isFilm = (e: ListEntry) => e.format === "MOVIE";

/** How many of the entry's episodes are watched: its progress, all of them once completed. */
export function watchedOf(e: ListEntry): number {
  if (isFilm(e)) return e.progress > 0 || e.status === "COMPLETED" || e.repeat > 0 ? 1 : 0;
  return Math.max(e.progress, e.status === "COMPLETED" ? (e.episodes ?? 0) : 0);
}

/** What the list holds for the import, as the Settings row says it before importing. */
export function previewList(entries: ListEntry[], showAdult: boolean): ListPreview {
  const kept = entries.filter((e) => showAdult || !e.isAdult);
  return {
    entries: kept,
    films: kept.filter(isFilm).length,
    shows: kept.filter((e) => !isFilm(e)).length,
    watched: kept.reduce((n, e) => n + watchedOf(e), 0),
    adult: entries.length - kept.length,
  };
}

/** The id the entry plays from, as its page and card pick it; undefined when there is none. */
async function playId(e: ListEntry, links: AnimeLink[], deps: ListImportDeps): Promise<{ id: string; zip?: AniZip | null } | undefined> {
  const stored = links.find((l) => l.anilist === e.mediaId)?.canonical;
  if (stored) return { id: stored };
  const listed = await deps.listed(e.mediaId).catch(() => null);
  if (listed?.imdb_id) return { id: listed.imdb_id };
  if (listed?.kitsu_id) return { id: `kitsu:${listed.kitsu_id}` };
  const zip = await deps.aniZip(e.mediaId).catch(() => null);
  const m = zip?.mappings;
  const id = m?.imdb_id ?? (m?.kitsu_id ? `kitsu:${m.kitsu_id}` : undefined);
  return id ? { id, zip } : undefined;
}

/** The videos of the entry's first `n` episodes in the show `meta` (an IMDb show, or the entry's own Kitsu one). */
async function watchedVideos(e: ListEntry, id: string, meta: Meta, n: number, zip: AniZip | null | undefined, deps: ListImportDeps): Promise<Video[]> {
  if (id.startsWith("kitsu:")) {
    const byNumber = new Map(meta.videos.map((v) => [v.episode, v]));
    return Array.from({ length: n }, (_, i) => byNumber.get(i + 1)).filter((v): v is Video => !!v);
  }
  const z = zip ?? (await deps.aniZip(e.mediaId).catch(() => null));
  const eps = regularEpisodes(z).slice(0, n);
  // An entry ani.zip files under this IMDb show matches as its page does; one linked to another show, by air date.
  const match = z?.mappings.imdb_id === id ? (ep: (typeof eps)[number]) => matchVideo(ep, meta.videos) : alignByAirDate(regularEpisodes(z), meta.videos);
  const seen = new Set<string>();
  return eps.map(match).filter((v): v is Video => !!v && !seen.has(v.id) && (seen.add(v.id), true));
}

/**
 * What to import from the entries {@link previewList} kept: a library item per id (the earliest
 * time one of its entries was added), and the watched episodes, finished in order just before the
 * entry last changed on AniList.
 */
export async function planListImport(entries: ListEntry[], choice: ListChoice, deps: ListImportDeps): Promise<ListPlan> {
  const run = deps.run ?? ((task) => task());
  const links = await deps.links().catch(() => []);
  const library = new Map<string, LibraryItem>();
  const progress = new Map<string, Progress>();
  let unlinked = 0;
  let unmatched = 0;
  let done = 0;
  await Promise.all(entries.map((e) => run(() => importEntry(e).finally(() => deps.step?.(++done, entries.length)))));
  return { library: [...library.values()], progress: [...progress.values()], unlinked, unmatched };

  async function importEntry(e: ListEntry) {
    const n = choice.watched ? watchedOf(e) : 0;
    if (!choice.library && !n) return;
    const found = await playId(e, links, deps);
    if (!found) {
      unlinked++;
      return;
    }
    const { id } = found;
    const type: ContentType = isFilm(e) ? "movie" : "series";
    const name = e.title ?? id;
    const addedAt = (e.createdAt || e.updatedAt) * 1000;
    const kept = library.get(id);
    if (choice.library && (!kept || addedAt < kept.addedAt)) library.set(id, { id, type, name: kept?.name ?? name, poster: kept?.poster ?? e.poster, addedAt });
    const at = e.updatedAt * 1000;
    if (n && type === "movie") {
      progress.set(id, { metaId: id, videoId: id, type, name, poster: e.poster, position: 1, duration: 1, updatedAt: at });
    } else if (n) {
      const meta = await deps.meta(type, id).catch(() => null);
      const videos = meta ? await watchedVideos(e, id, meta, n, found.zip, deps) : [];
      if (videos.length < n) unmatched++;
      const base = { metaId: id, type, name: meta?.name || name, poster: meta?.poster ?? e.poster, background: meta?.background };
      videos.forEach((v, i) => {
        const row: Progress = {
          ...base,
          videoId: v.id,
          season: v.season,
          episode: v.episode,
          episodeTitle: v.title,
          position: 1,
          duration: 1,
          updatedAt: at - (videos.length - i),
        };
        // The same video from two entries (a show IMDb splits differently): the later one.
        if ((progress.get(v.id)?.updatedAt ?? -1) < row.updatedAt) progress.set(v.id, row);
      });
    }
  }
}
