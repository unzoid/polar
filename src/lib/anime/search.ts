import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { MetaPreview } from "../types";
import { ANIME_GENRES, ANIME_TAGS, useAnimeBrowse, type AnimeCard } from "./anilist";

/** AniList's answer to a search: a genre or kind of show if it names one, otherwise a title search. */
export function useAnimeResults(query: string) {
  const lower = query.toLowerCase();
  const genre = ANIME_GENRES.find((g) => g.toLowerCase() === lower);
  const tag = genre ? undefined : ANIME_TAGS.find((t) => t.toLowerCase() === lower);
  const q = useAnimeBrowse(
    { search: genre || tag ? "" : query, genre: genre ?? "", tag: tag ?? "", season: "", year: 0, format: "", status: "", sort: "POPULARITY_DESC" },
    !!query,
  );
  return {
    title: genre || tag ? `${genre ?? tag} Anime` : "Anime",
    items: q.data?.pages[0]?.media,
    loading: !!query && q.isLoading,
  };
}

const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The IMDb id for an anime ani.zip can't link anywhere (new seasons often
 * have neither an IMDb nor a Kitsu id there yet): Cinemeta's entry with the
 * same title in any of AniList's languages and a year that agrees. Without
 * it the anime page has nothing to play, while the same show is right there
 * as a series.
 */
export function useImdbFallback(a: AnimeCard, enabled: boolean) {
  return useQuery({
    queryKey: ["anime", "imdb-fallback", a.id],
    enabled,
    staleTime: 24 * 60 * 60_000,
    queryFn: () => findImdbId(a),
  });
}

export async function findImdbId(a: AnimeCard): Promise<string | null> {
  const type = a.format === "MOVIE" ? "movies" : "series";
  const year = a.seasonYear ?? a.startDate?.year ?? undefined;
  const titles = [...new Set([a.title.english, a.title.romaji].filter((t): t is string => !!t))];
  for (const t of titles) {
    const found = (await api.search(t))[type].find((m) => {
      if (!m.id.startsWith("tt") || norm(m.name) !== norm(t)) return false;
      const y = Number(m.releaseInfo?.match(/\d{4}/)?.[0]);
      return !year || !y || Math.abs(y - year) <= 1;
    });
    if (found) return found.id;
  }
  return null;
}

/**
 * Movies and series that are one of these anime, gone: the same show shouldn't
 * come up twice, and its anime page (AniList's episodes, art, airing) is the
 * one to open. Same title in any of AniList's languages, and a year that agrees.
 */
export function withoutAnime(items: MetaPreview[] | undefined, anime: AnimeCard[] | undefined) {
  if (!items || !anime?.length) return items;
  const byTitle = new Map<string, (number | undefined)[]>();
  for (const a of anime) {
    const year = a.seasonYear ?? a.startDate?.year ?? undefined;
    for (const t of [a.title.english, a.title.romaji, a.title.native]) {
      const k = norm(t);
      if (k) byTitle.set(k, [...(byTitle.get(k) ?? []), year]);
    }
  }
  return items.filter((m) => {
    const years = byTitle.get(norm(m.name));
    if (!years) return true;
    const year = Number(m.releaseInfo?.match(/\d{4}/)?.[0]);
    // No year on either side: the title alone decides.
    return !years.some((y) => !y || !year || Math.abs(y - year) <= 1);
  });
}
