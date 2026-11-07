import { parseVideoId } from "../library/identity";
import { isRecord, num, str } from "../parse";
import type { ContentType } from "../types";

/**
 * What Polarity's titles and videos are on Simkl (#86). Simkl finds an item by any of the ids it
 * knows, IMDb's and Kitsu's among them, so Polarity's ids go across as they are: `tt…` films and
 * shows with their seasons, and anime played as `kitsu:N` by Kitsu's number, whose episodes are
 * numbered from the first without seasons, as Simkl takes an anime site's id
 * (api.simkl.org/guides/scrobble.md, "Anime").
 */
export type SimklIds = { imdb: string } | { kitsu: number };

export type SimklRef =
  | { kind: "movie"; ids: SimklIds }
  | { kind: "show"; ids: SimklIds }
  /** `season` only for IMDb shows: a Kitsu anime's episodes are numbered whole. */
  | { kind: "episode"; ids: SimklIds; season?: number; number: number };

/** The Simkl film, show or episode a Polarity video is; `undefined` when Simkl can't be told which (files on this device). */
export function simklRefOf(videoId: string, type: ContentType): SimklRef | undefined {
  const v = parseVideoId(videoId);
  if (!v) return undefined;
  const ids: SimklIds = v.title.kind === "imdb" ? { imdb: v.title.value } : { kitsu: Number(v.title.value) };
  if (v.episode === undefined) return { kind: type === "movie" ? "movie" : "show", ids };
  if ("kitsu" in ids) return { kind: "episode", ids, number: v.episode };
  return { kind: "episode", ids, season: v.season ?? 1, number: v.episode };
}

/** Whether two refs are the same item. */
export function sameSimklRef(a: SimklRef, b: SimklRef): boolean {
  if (a.kind !== b.kind || JSON.stringify(a.ids) !== JSON.stringify(b.ids)) return false;
  return a.kind !== "episode" || (b.kind === "episode" && a.season === b.season && a.number === b.number);
}

/**
 * The ref as a scrobble's body: `{ movie }`, `{ show, episode }` for an IMDb show, or
 * `{ anime, episode }` with the episode's number alone for a Kitsu one.
 */
export function simklScrobbleBody(ref: SimklRef): Record<string, unknown> {
  if (ref.kind !== "episode") return { [ref.kind]: { ids: ref.ids } };
  if (ref.season === undefined) return { anime: { ids: ref.ids }, episode: { number: ref.number } };
  return { show: { ids: ref.ids }, episode: { season: ref.season, number: ref.number } };
}

/** One item in a `/sync/…` batch, with what goes with it there (`watched_at`). */
export interface SimklSyncItem {
  ref: SimklRef;
  extra?: Record<string, string | number>;
}

/**
 * A `/sync/history` (or `/sync/history/remove`) body: films in `movies`, shows and anime in
 * `shows` (where Simkl wants anime now), an IMDb show's episodes under their season, a Kitsu
 * anime's in the show's own `episodes`.
 */
export function simklSyncBody(items: SimklSyncItem[]): { movies: unknown[]; shows: unknown[] } {
  const movies: unknown[] = [];
  type Show = { ids: SimklIds; extra?: SimklSyncItem["extra"]; seasons?: Map<number, unknown[]>; episodes?: unknown[] };
  const shows = new Map<string, Show>();
  const show = (ids: SimklIds) => {
    const key = JSON.stringify(ids);
    let s = shows.get(key);
    if (!s) shows.set(key, (s = { ids }));
    return s;
  };
  for (const { ref, extra } of items) {
    if (ref.kind === "movie") movies.push({ ids: ref.ids, ...extra });
    else if (ref.kind === "show") Object.assign(show(ref.ids), { extra });
    else {
      const s = show(ref.ids);
      const episode = { number: ref.number, ...extra };
      if (ref.season === undefined) (s.episodes ??= []).push(episode);
      else {
        s.seasons ??= new Map();
        s.seasons.set(ref.season, [...(s.seasons.get(ref.season) ?? []), episode]);
      }
    }
  }
  return {
    movies,
    shows: [...shows.values()].map(({ ids, extra, seasons, episodes }) => ({
      ids,
      ...extra,
      ...(seasons ? { seasons: [...seasons].map(([number, episodes]) => ({ number, episodes })) } : {}),
      ...(episodes ? { episodes } : {}),
    })),
  };
}

/** The kinds Simkl keeps its lists by. */
export type SimklKind = "shows" | "movies" | "anime";

export const SIMKL_KINDS: readonly SimklKind[] = ["shows", "movies", "anime"];

/** A whole number above 0, as a number or as digits. */
export const positiveId = (v: unknown) => {
  const n = num(v) ?? (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
  return n !== undefined && Number.isInteger(n) && n > 0 ? n : undefined;
};

/**
 * The Polarity id of a Simkl title: its IMDb id, or for anime its Kitsu number when Simkl has one
 * (what Polarity plays anime by, and sends them by); `undefined` when it has neither.
 */
export function polarityIdOf(kind: SimklKind, ids: unknown): string | undefined {
  return polarityIdsOf(kind, ids)[0];
}

/** Every Polarity id a Simkl title can be found by: an anime's `kitsu:N` first, then the IMDb id. */
export function polarityIdsOf(kind: SimklKind, ids: unknown): string[] {
  if (!isRecord(ids)) return [];
  const imdb = str(ids.imdb);
  const kitsu = kind === "anime" ? positiveId(ids.kitsu) : undefined;
  const out = kitsu ? [`kitsu:${kitsu}`] : [];
  if (imdb && /^tt\d{1,10}$/.test(imdb)) out.push(imdb);
  return out;
}

/** Simkl's lists. Films have no `watching` or `hold`. */
export type SimklStatus = "watching" | "plantowatch" | "hold" | "completed" | "dropped";

export const SIMKL_STATUSES: readonly SimklStatus[] = ["watching", "plantowatch", "hold", "completed", "dropped"];
