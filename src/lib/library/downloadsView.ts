import { storeLocal } from "../errors";
import { isRecord, storedJson } from "../parse";
import type { ContentType, Progress } from "../types";
import type { Download } from "./downloads";

/**
 * Library → Downloads laid out (#15): what's still coming down in a section of its own, the rest
 * grouped by title (and by season inside a show with more than one), sorted, filtered and searched,
 * with the totals and the watched marks the bulk deletes work from. Pure, so it's tested without a page.
 */

export type DownloadFilter = "all" | "movie" | "series" | "active";
export type DownloadSort = "recent" | "title" | "size" | "watched";

export const DOWNLOAD_FILTERS: { value: DownloadFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "series", label: "Shows" },
  { value: "active", label: "In Progress" },
];

export const DOWNLOAD_SORTS: { value: DownloadSort; label: string }[] = [
  { value: "recent", label: "Recently Downloaded" },
  { value: "title", label: "Title" },
  { value: "size", label: "Size" },
  { value: "watched", label: "Recently Watched" },
];

/** More titles than this and the page offers a search field. */
export const SEARCH_FROM = 10;

export interface DownloadSeason {
  /** Group key, unique on the page: `<metaId>/<season>`. */
  key: string;
  season: number;
  items: Download[];
  bytes: number;
  unwatched: number;
}

export interface DownloadTitle {
  key: string;
  metaId: string;
  type: ContentType;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  items: Download[];
  /** Only for a show with episodes from more than one season; else the items are listed straight. */
  seasons: DownloadSeason[];
  bytes: number;
  unwatched: number;
  /** The latest of its downloads' `addedAt`. */
  addedAt: number;
  /** When any of it was last played, 0 when never. */
  watchedAt: number;
}

/** What a download takes on disk now: a finished file its whole size, one still coming down what's arrived. */
export const bytesOnDisk = (d: Download) => (d.state === "done" ? (d.total ?? d.received) : d.received);

const sumBytes = (list: Download[]) => list.reduce((n, d) => n + bytesOnDisk(d), 0);

/** Still coming down, paused or failed: the section above the finished ones. */
export const isActive = (d: Download) => d.state !== "done";

/** Every download's watched state, from the titles' progress (`watchedFraction()` passed in, as episodeState does). */
export function watchedSet(progress: Progress[], threshold: number): Set<string> {
  const set = new Set<string>();
  for (const p of progress) if (p.duration > 0 && p.position / p.duration >= threshold) set.add(p.videoId);
  return set;
}

/** Specials (season 0) after the regular seasons, then by episode. */
const byEpisode = (a: Download, b: Download) =>
  seasonRank(a.season) - seasonRank(b.season) || (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0);
const seasonRank = (s: number | undefined) => (s === 0 ? 1 : 0);

/**
 * The finished downloads (or the active ones: call with whichever list) grouped by title, each show's
 * episodes in order and by season when they span more than one. `watched` holds watched video ids;
 * `lastWatched` maps a title to when it was last played.
 */
export function groupDownloads(list: Download[], watched: Set<string>, lastWatched: Map<string, number>): DownloadTitle[] {
  const byTitle = new Map<string, Download[]>();
  for (const d of list) byTitle.set(d.metaId, [...(byTitle.get(d.metaId) ?? []), d]);
  return [...byTitle.entries()].map(([metaId, items]) => {
    items.sort(byEpisode);
    const first = items[0];
    const unwatchedIn = (l: Download[]) => l.filter((d) => !watched.has(d.id)).length;
    const seasonNumbers = [...new Set(items.map((d) => d.season ?? 0))];
    const seasons: DownloadSeason[] =
      first.type === "series" && seasonNumbers.length > 1
        ? seasonNumbers.map((season) => {
            const of = items.filter((d) => (d.season ?? 0) === season);
            return { key: `${metaId}/${season}`, season, items: of, bytes: sumBytes(of), unwatched: unwatchedIn(of) };
          })
        : [];
    return {
      key: metaId,
      metaId,
      type: first.type,
      name: first.name,
      poster: items.find((d) => d.poster)?.poster,
      background: items.find((d) => d.background)?.background,
      logo: items.find((d) => d.logo)?.logo,
      items,
      seasons,
      bytes: sumBytes(items),
      unwatched: unwatchedIn(items),
      addedAt: Math.max(...items.map((d) => d.addedAt)),
      watchedAt: lastWatched.get(metaId) ?? 0,
    };
  });
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Newest first for the dates and sizes (title A–Z breaks ties), A–Z for the title. */
export function sortTitles(titles: DownloadTitle[], sort: DownloadSort): DownloadTitle[] {
  const byName = (a: DownloadTitle, b: DownloadTitle) => collator.compare(a.name, b.name);
  const key: Record<DownloadSort, (t: DownloadTitle) => number> = {
    recent: (t) => t.addedAt,
    size: (t) => t.bytes,
    watched: (t) => t.watchedAt,
    title: () => 0,
  };
  return [...titles].sort((a, b) => key[sort](b) - key[sort](a) || byName(a, b));
}

/** Ignores case and accents, so "amelie" finds "Amélie". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

/** Movies, shows or everything (the In Progress filter keeps every kind: it hides the finished section instead). */
export function filterTitles(titles: DownloadTitle[], filter: DownloadFilter, query: string): DownloadTitle[] {
  const q = fold(query.trim());
  return titles.filter(
    (t) =>
      (filter === "all" || filter === "active" || t.type === filter) &&
      (!q || fold(t.name).includes(q) || t.items.some((d) => d.episodeTitle && fold(d.episodeTitle).includes(q))),
  );
}

export interface DownloadsSummary {
  count: number;
  bytes: number;
}

/** "23 downloads · 41.7 GB": every record, and what they take on disk. */
export const downloadsSummary = (list: Download[]): DownloadsSummary => ({ count: list.length, bytes: sumBytes(list) });

/** The active section's overall progress: how much of what's known has arrived (undefined while no size is known). */
export function activeProgress(list: Download[]): number | undefined {
  const sized = list.filter((d) => d.total);
  if (!sized.length) return undefined;
  const total = sized.reduce((n, d) => n + d.total!, 0);
  return Math.min(1, sized.reduce((n, d) => n + d.received, 0) / total);
}

/** The ids of `list` already watched: what "Delete Watched" removes. */
export const watchedIds = (list: Download[], watched: Set<string>) => list.filter((d) => watched.has(d.id)).map((d) => d.id);

// --- What the page remembers: open groups, sort and filter, on this device.

export interface DownloadsView {
  open: string[];
  sort: DownloadSort;
  filter: DownloadFilter;
}

const VIEW_KEY = "polar.downloads.view";
const DEFAULT_VIEW: DownloadsView = { open: [], sort: "recent", filter: "all" };

/** The saved view, each part checked (anything unknown falls back to the default). */
export function readDownloadsView(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): DownloadsView {
  const v = storedJson(storage, VIEW_KEY);
  if (!isRecord(v)) return DEFAULT_VIEW;
  const open = Array.isArray(v.open) ? v.open.filter((k): k is string => typeof k === "string").slice(0, 500) : [];
  const sort = DOWNLOAD_SORTS.some((s) => s.value === v.sort) ? (v.sort as DownloadSort) : DEFAULT_VIEW.sort;
  const filter = DOWNLOAD_FILTERS.some((f) => f.value === v.filter) ? (v.filter as DownloadFilter) : DEFAULT_VIEW.filter;
  return { open, sort, filter };
}

export function saveDownloadsView(view: DownloadsView, storage?: Pick<Storage, "setItem">) {
  storeLocal(VIEW_KEY, JSON.stringify(view), storage);
}

/** Open groups whose title or season is gone are forgotten, so the list doesn't grow forever. */
export const keepOpen = (open: string[], titles: DownloadTitle[]) => {
  const live = new Set(titles.flatMap((t) => [t.key, ...t.seasons.map((s) => s.key)]));
  return open.filter((k) => live.has(k));
};
