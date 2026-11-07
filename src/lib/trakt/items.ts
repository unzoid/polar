import { parseVideoId } from "../library/identity";
import { isRecord, num, str } from "../parse";
import type { ContentType } from "../types";

/**
 * What Polarity's titles and videos are on Trakt (#85). Trakt knows films and shows by their IMDb
 * id, so Polarity's `tt…` ids go across as they are: a film as itself, an episode as its show
 * with its season and number. An anime Polarity plays as `kitsu:N` has no IMDb page by
 * definition (docs/anime-identity.md) and isn't sent; its page says so when Trakt is linked.
 */
export type TraktRef = { kind: "movie"; imdb: string } | { kind: "show"; imdb: string } | { kind: "episode"; imdb: string; season: number; number: number };

const IMDB = /^tt\d{1,10}$/;

/** The Trakt film, show or episode a Polarity video is; `undefined` when Trakt can't be told which. */
export function traktRefOf(videoId: string, type: ContentType): TraktRef | undefined {
  const v = parseVideoId(videoId);
  if (!v || v.title.kind !== "imdb") return undefined;
  const imdb = v.title.value;
  if (v.episode === undefined) return { kind: type === "movie" ? "movie" : "show", imdb };
  // Specials (season 0) are Trakt's season 0 too.
  return { kind: "episode", imdb, season: v.season ?? 1, number: v.episode };
}

/** The Polarity id of a Trakt ref: the video for an episode, the title otherwise. */
export const videoIdOf = (ref: TraktRef) => (ref.kind === "episode" ? `${ref.imdb}:${ref.season}:${ref.number}` : ref.imdb);

/** The ref as a scrobble's body: `{ movie }` or `{ show, episode }`. */
export function scrobbleBody(ref: TraktRef): Record<string, unknown> {
  if (ref.kind === "episode") return { show: { ids: { imdb: ref.imdb } }, episode: { season: ref.season, number: ref.number } };
  return { [ref.kind]: { ids: { imdb: ref.imdb } } };
}

/** One item in a `/sync/…` batch, with what goes with it there (`watched_at`, `rated_at`, `rating`). */
export interface SyncItem {
  ref: TraktRef;
  extra?: Record<string, string | number>;
}

/**
 * A `/sync/history`, `/sync/watchlist` or `/sync/ratings` body: films in `movies`, shows in
 * `shows`, episodes under their show and season, the way Trakt takes them without its own ids.
 */
export function syncBody(items: SyncItem[]): { movies: unknown[]; shows: unknown[] } {
  const movies: unknown[] = [];
  const shows = new Map<string, { ids: { imdb: string }; seasons?: Map<number, unknown[]>; extra?: SyncItem["extra"] }>();
  const show = (imdb: string) => {
    let s = shows.get(imdb);
    if (!s) shows.set(imdb, (s = { ids: { imdb } }));
    return s;
  };
  for (const { ref, extra } of items) {
    if (ref.kind === "movie") movies.push({ ids: { imdb: ref.imdb }, ...extra });
    else if (ref.kind === "show") Object.assign(show(ref.imdb), { extra });
    else {
      const s = show(ref.imdb);
      s.seasons ??= new Map();
      const episodes = s.seasons.get(ref.season) ?? [];
      episodes.push({ number: ref.number, ...extra });
      s.seasons.set(ref.season, episodes);
    }
  }
  return {
    movies,
    shows: [...shows.values()].map(({ ids, seasons, extra }) => ({
      ids,
      ...extra,
      ...(seasons ? { seasons: [...seasons].map(([number, episodes]) => ({ number, episodes })) } : {}),
    })),
  };
}

/** A ref from Trakt's own item (`movie`, `show`, `episode` + `show`), by its IMDb id; `undefined` without one. */
export function readTraktItem(v: unknown): TraktRef | undefined {
  if (!isRecord(v)) return undefined;
  const imdbOf = (o: unknown) => {
    const id = isRecord(o) && isRecord(o.ids) ? str(o.ids.imdb) : undefined;
    return id && IMDB.test(id) ? id : undefined;
  };
  const type = str(v.type);
  if (type === "movie") {
    const imdb = imdbOf(v.movie);
    return imdb ? { kind: "movie", imdb } : undefined;
  }
  const imdb = imdbOf(v.show);
  if (!imdb) return undefined;
  if (type === "show") return { kind: "show", imdb };
  if (type === "episode" && isRecord(v.episode)) {
    const [season, number] = [num(v.episode.season), num(v.episode.number)];
    if (season === undefined || number === undefined || season < 0 || number < 1) return undefined;
    return { kind: "episode", imdb, season, number };
  }
  return undefined;
}
