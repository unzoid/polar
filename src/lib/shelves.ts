import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useReducer } from "react";
import { api } from "./api";
import { keys, useCatalog, useContinueWatching, useLibrary, useWatchHistory } from "./queries";
import type { ContentType, MetaPreview, Progress } from "./types";
import { watchedFraction } from "./watched";

/**
 * What the home screens show, shared by the desktop and TV layouts: the
 * featured picks, the trending picks, and the day's shelves — which
 * alternate card shape and mix sources (trending, new, genres, hidden gems,
 * classics, "Because you watched …") so no two neighbours look or read alike.
 * Which genres appear rotates daily.
 */
export type Shape = "poster" | "landscape";
export type Shelf =
  | { kind: "catalog"; type: ContentType; id: string; genre?: string; title: string; shape: Shape }
  | { kind: "because"; type: ContentType; seed: string; title: string; shape: Shape };

export const shelfKey = (s: Shelf) =>
  s.kind === "catalog" ? keys.catalog(s.type, s.id, s.genre) : keys.recommend(s.type, s.seed);

/** Genre shelves; a handful are picked each day. */
export const GENRES: { type: ContentType; genre: string; title: string }[] = [
  { type: "movie", genre: "Action", title: "Action & Adventure" },
  { type: "movie", genre: "Sci-Fi", title: "Sci-Fi Movies" },
  { type: "movie", genre: "Animation", title: "Animated Movies" },
  { type: "movie", genre: "Comedy", title: "Comedy Movies" },
  { type: "movie", genre: "Horror", title: "Horror Movies" },
  { type: "movie", genre: "Thriller", title: "Thrillers" },
  { type: "movie", genre: "Romance", title: "Romance Movies" },
  { type: "movie", genre: "Crime", title: "Crime Movies" },
  { type: "movie", genre: "Fantasy", title: "Fantasy Movies" },
  { type: "movie", genre: "Documentary", title: "Documentaries" },
  { type: "series", genre: "Comedy", title: "Comedy Series" },
  { type: "series", genre: "Crime", title: "Crime Series" },
  { type: "series", genre: "Drama", title: "Drama Series" },
  { type: "series", genre: "Sci-Fi", title: "Sci-Fi & Fantasy Series" },
  { type: "series", genre: "Animation", title: "Animated Series" },
  { type: "series", genre: "Mystery", title: "Mystery Series" },
  { type: "series", genre: "Documentary", title: "Docuseries" },
];

/** Stable pseudo-random 0..1 for (day, key): same order all day, new one tomorrow. */
function dailyNoise(day: number, key: string) {
  let h = 2166136261 ^ day;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export interface Seed {
  type: ContentType;
  id: string;
  name: string;
}

export function todaysShelves(seeds: Seed[]): Shelf[] {
  const day = Math.floor(Date.now() / 86_400_000);
  const genres = [...GENRES].sort((a, b) => dailyNoise(day, a.type + a.genre) - dailyNoise(day, b.type + b.genre));
  const genre = (i: number, shape: Shape): Shelf => ({ kind: "catalog", id: "popular", shape, ...genres[i] });
  const catalog = (type: ContentType, id: string, title: string, shape: Shape): Shelf => ({ kind: "catalog", type, id, title, shape });
  const because = (i: number, shape: Shape): Shelf[] =>
    seeds[i] ? [{ kind: "because", type: seeds[i].type, seed: seeds[i].id, title: `Because you watched ${seeds[i].name}`, shape }] : [];

  return [
    ...because(0, "landscape"),
    catalog("series", "trending", "Trending Series", "landscape"),
    catalog("movie", "new", "New Movies", "poster"),
    genre(0, "landscape"),
    catalog("series", "popular", "Popular Series", "poster"),
    ...because(1, "landscape"),
    catalog("movie", "popular", "Popular Movies", "poster"),
    genre(1, "landscape"),
    catalog("movie", "gems", "Hidden Gems", "poster"),
    genre(2, "landscape"),
    catalog("series", "new", "New Series", "poster"),
    genre(3, "landscape"),
    catalog("movie", "classics", "Classic Movies", "poster"),
    catalog("series", "top_rated", "Top Rated Series", "landscape"),
    genre(4, "poster"),
    catalog("series", "gems", "Hidden Gem Series", "landscape"),
    catalog("movie", "top_rated", "Top Rated Movies", "poster"),
    genre(5, "landscape"),
    catalog("series", "classics", "Classic Series", "poster"),
  ];
}

/** The two titles you were most recently into (watching, else saved). */
export function useSeeds(): Seed[] {
  const { data: watching } = useContinueWatching();
  const { data: library } = useLibrary();
  return useMemo(() => {
    const candidates: Seed[] = [
      ...[...(watching ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => ({ type: p.type, id: p.metaId, name: p.name })),
      ...[...(library ?? [])].sort((a, b) => b.addedAt - a.addedAt).map((l) => ({ type: l.type, id: l.id, name: l.name })),
    ];
    const seen = new Set<string>();
    return candidates.filter((s) => !seen.has(s.id) && seen.add(s.id)).slice(0, 2);
  }, [watching, library]);
}

/**
 * For each shelf, the ids already shown above it (`top`, then earlier
 * shelves), recomputed as shelves finish loading.
 */
export function useShownAbove(shelves: Shelf[], top: MetaPreview[]) {
  const qc = useQueryClient();
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () =>
      qc.getQueryCache().subscribe((e) => {
        const root = e.query.queryKey[0];
        if (e.type === "updated" && e.action.type === "success" && (root === "catalog" || root === "recommend")) bump();
      }),
    [qc],
  );
  return useMemo(() => {
    void version;
    const shown = new Set(top.map((m) => m.id));
    return shelves.map((s) => {
      const above = new Set(shown);
      for (const m of qc.getQueryData<MetaPreview[]>(shelfKey(s)) ?? []) shown.add(m.id);
      return above;
    });
  }, [shelves, top, version, qc]);
}

/** Featured titles: a mix of trending series and movies that have full art. */
export function useFeatured() {
  return useQuery({
    queryKey: ["featured"],
    queryFn: async () => {
      const [series, movies] = await Promise.all([api.catalog("series", "trending"), api.catalog("movie", "trending")]);
      const pick = (list: MetaPreview[]) => list.filter((m) => m.background && m.description).slice(0, 4);
      const s = pick(series);
      const m = pick(movies);
      // Interleave so the carousel alternates TV and film.
      return s.flatMap((item, i) => (m[i] ? [item, m[i]] : [item])).slice(0, 7);
    },
  });
}

/**
 * Trending titles, series and movies alternating. Needs both a poster and a
 * backdrop; skips `skip` (what a hero above is already featuring).
 */
export function trendingPicks(series?: MetaPreview[], movies?: MetaPreview[], skip: MetaPreview[] = [], size = 12) {
  const skipIds = new Set(skip.map((f) => f.id));
  const usable = (list?: MetaPreview[]) => (list ?? []).filter((m) => m.poster && m.background && !skipIds.has(m.id));
  const s = usable(series);
  const m = usable(movies);
  const out: MetaPreview[] = [];
  for (let i = 0; out.length < size && (i < s.length || i < m.length); i++) {
    if (s[i]) out.push(s[i]);
    if (m[i] && out.length < size) out.push(m[i]);
  }
  return out;
}

/** Trending series and movies, loaded. */
export function useTrending() {
  const series = useCatalog("series", "trending");
  const movies = useCatalog("movie", "trending");
  return { series: series.data, movies: movies.data };
}

export interface LibrarySeed extends Seed {
  /** How it got into your life, for the shelf title. */
  via: "saved" | "watched";
}

/** At most this many titles seed the Library's recommendations (one request each). */
const LIBRARY_SEEDS = 4;
const FOR_YOU_SIZE = 30;

/**
 * Recommendations for the Library: titles like the ones you've saved and
 * watched most recently, merged into one "For You" shelf (round-robin, so no
 * single seed dominates), plus a "Because you …" shelf per seed. Leaves out
 * everything you've already saved or watched.
 */
export function useLibraryRecommendations() {
  const { data: library } = useLibrary();
  const { data: history } = useWatchHistory();
  const seeds = useMemo<LibrarySeed[]>(() => {
    const saved = [...(library ?? [])]
      .sort((a, b) => b.addedAt - a.addedAt)
      .map((l): LibrarySeed => ({ type: l.type, id: l.id, name: l.name, via: "saved" }));
    const watched = (history ?? []).map((p): LibrarySeed => ({ type: p.type, id: p.metaId, name: p.name, via: "watched" }));
    // Alternate the two sources so both shape what's recommended.
    const mixed = Array.from({ length: Math.max(saved.length, watched.length) }, (_, i) => [watched[i], saved[i]]).flat();
    const seen = new Set<string>();
    return mixed.filter((s): s is LibrarySeed => !!s && !seen.has(s.id) && !!seen.add(s.id)).slice(0, LIBRARY_SEEDS);
  }, [library, history]);

  const results = useQueries({
    queries: seeds.map((s) => ({
      queryKey: keys.recommend(s.type, s.id),
      queryFn: () => api.recommend(s.type, s.id),
      staleTime: 60 * 60_000,
    })),
  });
  const lists = results.map((r) => (r.isError ? [] : r.data));
  const settled = !!library && !!history && lists.every(Boolean);
  // A stable key for the memo: the lists only change when a query lands.
  const stamp = results.map((r) => r.dataUpdatedAt).join();

  return useMemo(() => {
    void stamp;
    const owned = new Set([...(library ?? []).map((l) => l.id), ...(history ?? []).map((p) => p.metaId)]);
    const fresh = lists.map((l) => (l ?? []).filter((m) => !owned.has(m.id)));
    let forYou: MetaPreview[] | undefined;
    if (settled) {
      forYou = [];
      const seen = new Set<string>();
      for (let i = 0; forYou.length < FOR_YOU_SIZE && fresh.some((l) => i < l.length); i++) {
        for (const l of fresh) {
          const m = l[i];
          if (m && !seen.has(m.id) && forYou.length < FOR_YOU_SIZE) {
            seen.add(m.id);
            forYou.push(m);
          }
        }
      }
    }
    return {
      seeds,
      forYou,
      because: seeds.map((seed, i) => ({
        seed,
        title: `Because you ${seed.via} ${seed.name}`,
        items: lists[i] ? fresh[i] : undefined,
      })),
    };
  }, [seeds, settled, stamp, library, history]);
}

/** A watch-history entry as a title card. */
export const progressItem = (p: Progress): MetaPreview => ({
  id: p.metaId,
  type: p.type,
  name: p.name,
  background: p.background,
  poster: p.poster,
});

/** How far through a history entry is, 0..1 (a finished one reads as complete). */
export const progressFraction = (p: Progress) => (!p.duration ? 0 : p.position / p.duration >= watchedFraction() ? 1 : p.position / p.duration);
