import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { MetaPreview } from "../types";
import { ANIME_GENRES, ANIME_TAGS, gql, useAnimeBrowse, type AnimeCard } from "./anilist";
import { fetchAniZip } from "./anizip";

/** AniList's answer to a search: a genre or kind of show if it names one, otherwise a title search. */
export function useAnimeResults(query: string) {
  const lower = query.toLowerCase();
  const genre = ANIME_GENRES.find((g) => g.toLowerCase() === lower);
  const tag = genre ? undefined : ANIME_TAGS.find((t) => t.toLowerCase() === lower);
  const q = useAnimeBrowse(
    { search: genre || tag ? "" : query, genre: genre ?? "", tag: tag ?? "", season: "", year: 0, format: "", status: "", sort: "POPULARITY_DESC" },
    !!query,
  );
  const items = q.data?.pages[0]?.media;
  return {
    title: genre || tag ? `${genre ?? tag} Anime` : "Anime",
    items: items && !genre && !tag ? oneFranchiseEach(byRelevance(items, query)) : items,
    loading: !!query && q.isLoading,
  };
}

/**
 * A search answers with every season of a franchise (Paleblade, then each part
 * of Hundred-Night Ash War): keep the first of each, in the order given.
 * Its page has the rest as season tabs. Entries count as one franchise when
 * one is the other's prequel or sequel, directly or through the others.
 */
export function oneFranchiseEach(items: AnimeCard[]): AnimeCard[] {
  const root = new Map<number, number>(items.map((a) => [a.id, a.id]));
  const find = (id: number): number => {
    const up = root.get(id)!;
    if (up === id) return id;
    const top = find(up);
    root.set(id, top);
    return top;
  };
  for (const a of items) for (const b of a.chain ?? []) if (root.has(b)) root.set(find(b), find(a.id));
  const seen = new Set<number>();
  return items.filter((a) => {
    const r = find(a.id);
    return !seen.has(r) && !!seen.add(r);
  });
}

const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * AniList's SEARCH_MATCH puts any title containing the words first, so a
 * 100-view music video called "Hello Again, Kiko" beats Kiko's Bizarre
 * Adventure. Rank by how well a title matches, weighed against how many
 * people know the show (popularity, on a log scale).
 */
function byRelevance(items: AnimeCard[], query: string): AnimeCard[] {
  const q = norm(query);
  const match = (a: AnimeCard) => {
    const titles = [a.title.romaji, a.title.english, a.title.native].map(norm).filter(Boolean);
    if (titles.some((t) => t === q)) return 2;
    if (titles.some((t) => t.startsWith(q))) return 1.5;
    if (titles.some((t) => t.includes(q))) return 0.5;
    return 0;
  };
  const score = (a: AnimeCard) => match(a) + Math.log10((a.popularity ?? 0) + 1);
  return items
    .map((a, i) => ({ a, s: score(a) - i * 0.01 }))
    .sort((x, y) => y.s - x.s)
    .map((x) => x.a);
}

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

/** AniList formats that are the show itself, for a Cinemeta series or movie. */
const MAIN_FORMATS = { series: ["TV", "TV_SHORT", "ONA"], movie: ["MOVIE"] } as const;

/**
 * The AniList entry an IMDb title is, for opening it as an anime. ani.zip
 * answers an IMDb id with whichever entry it lists first, and one IMDb id
 * covers every season and special: Grey Thistle's is a 2016 OVA with one
 * episode. When that entry isn't the right kind (a series that comes back as
 * an OVA), the main show is looked up on AniList by title and first year,
 * and taken only if ani.zip links it to the same IMDb id. Null: open it as
 * a plain series or movie.
 */
export async function anilistForImdb(imdbId: string, title: { type: string; name: string; year?: number }): Promise<number | null> {
  const zip = await fetchAniZip({ imdb_id: imdbId });
  const id = zip?.mappings.anilist_id;
  if (!id) return null;
  const formats: readonly string[] = title.type === "movie" ? MAIN_FORMATS.movie : MAIN_FORMATS.series;
  if (!zip.mappings.type || formats.includes(zip.mappings.type)) return id;

  const data = await gql<{ Page: { media: { id: number; startDate?: { year?: number | null } }[] } }>(
    `query ($search: String, $formats: [MediaFormat]) {
      Page(perPage: 6) { media(type: ANIME, search: $search, format_in: $formats, sort: [SEARCH_MATCH, POPULARITY_DESC]) { id startDate { year } } }
    }`,
    { search: title.name, formats },
  ).catch(() => null);
  const candidates = (data?.Page.media ?? []).sort(
    (a, b) => Number(a.startDate?.year !== title.year) - Number(b.startDate?.year !== title.year),
  );
  for (const c of candidates.slice(0, 3)) {
    const z = await fetchAniZip({ anilist_id: c.id }).catch(() => null);
    if (z?.mappings.imdb_id === imdbId) return c.id;
  }
  return null;
}
