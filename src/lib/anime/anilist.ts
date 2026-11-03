import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { usePrefs } from "../prefs";

/**
 * AniList (graphql.anilist.co): the anime catalogue, seasons, the airing
 * schedule, relations, characters and voice actors. Public and keyless.
 *
 * It rate-limits per IP (30–90 requests a minute), so the Anime page asks for
 * all of its shelves in one request, results are cached generously, and a 429
 * waits out Retry-After once before giving up.
 */
const ENDPOINT = "https://graphql.anilist.co";

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(Number(res.headers.get("Retry-After")) || 5, 30);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const json = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
    if (!res.ok || !json?.data) throw new Error(json?.errors?.[0]?.message ?? `AniList answered ${res.status}`);
    return json.data;
  }
}

// --- Types -----------------------------------------------------------------

export type MediaFormat = "TV" | "TV_SHORT" | "MOVIE" | "SPECIAL" | "OVA" | "ONA" | "MUSIC" | "MANGA" | "NOVEL" | "ONE_SHOT";
export type MediaStatus = "FINISHED" | "RELEASING" | "NOT_YET_RELEASED" | "CANCELLED" | "HIATUS";
export type MediaSeason = "WINTER" | "SPRING" | "SUMMER" | "FALL";

export interface FuzzyDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

export interface AnimeTitle {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
}

/** What a card needs. */
export interface AnimeCard {
  id: number;
  idMal?: number | null;
  type?: "ANIME" | "MANGA";
  title: AnimeTitle;
  coverImage: { extraLarge?: string | null; large?: string | null; color?: string | null };
  bannerImage?: string | null;
  format?: MediaFormat | null;
  status?: MediaStatus | null;
  episodes?: number | null;
  duration?: number | null;
  season?: MediaSeason | null;
  seasonYear?: number | null;
  averageScore?: number | null;
  popularity?: number | null;
  genres?: string[];
  startDate?: FuzzyDate;
  nextAiringEpisode?: { episode: number; airingAt: number; timeUntilAiring: number } | null;
  /** Only on the shelves that show a synopsis (LISTED), and the anime's own page. */
  description?: string | null;
}

export interface AnimeTag {
  name: string;
  rank: number;
  description?: string | null;
  isMediaSpoiler: boolean;
  isGeneralSpoiler: boolean;
  category?: string | null;
}

export interface Person {
  id: number;
  name: { full: string; native?: string | null };
  image?: { large?: string | null } | null;
}

export interface CharacterEdge {
  role: "MAIN" | "SUPPORTING" | "BACKGROUND";
  node: Person;
  ja: Person[];
  en: Person[];
}

export type RelationType =
  | "ADAPTATION"
  | "PREQUEL"
  | "SEQUEL"
  | "PARENT"
  | "SIDE_STORY"
  | "CHARACTER"
  | "SUMMARY"
  | "ALTERNATIVE"
  | "SPIN_OFF"
  | "OTHER"
  | "SOURCE"
  | "COMPILATION"
  | "CONTAINS";

export interface Anime extends AnimeCard {
  description?: string | null;
  synonyms?: string[];
  source?: string | null;
  hashtag?: string | null;
  endDate?: FuzzyDate;
  meanScore?: number | null;
  favourites?: number | null;
  isAdult?: boolean;
  countryOfOrigin?: string | null;
  trailer?: { id: string; site: string } | null;
  studios: { edges: { isMain: boolean; node: { id: number; name: string; isAnimationStudio: boolean } }[] };
  tags: AnimeTag[];
  relations: { edges: { relationType: RelationType; node: AnimeCard }[] };
  characters: { edges: CharacterEdge[] };
  staff: { edges: { role: string; node: Person }[] };
  recommendations: { nodes: { mediaRecommendation: AnimeCard | null }[] };
  externalLinks: { site: string; url: string; type?: string | null; color?: string | null; icon?: string | null; language?: string | null }[];
  rankings: { rank: number; type: "RATED" | "POPULAR"; context: string; allTime: boolean; season?: MediaSeason | null; year?: number | null }[];
  airingSchedule: { nodes: { episode: number; airingAt: number }[] };
}

// --- Queries ---------------------------------------------------------------

const CARD = `
  id idMal type
  title { romaji english native }
  coverImage { extraLarge large color }
  bannerImage format status episodes duration season seasonYear
  averageScore popularity genres
  startDate { year month day }
  nextAiringEpisode { episode airingAt timeUntilAiring }
`;

/** A card on the Anime page, where the carousel and the TV stage show its synopsis. */
const LISTED = `${CARD} description(asHtml: false)`;

/** Northern-hemisphere anime seasons, as AniList (and Japan's TV schedule) uses them. */
export function seasonOf(date = new Date()): { season: MediaSeason; year: number } {
  const m = date.getMonth();
  const year = date.getFullYear();
  if (m <= 2) return { season: "WINTER", year };
  if (m <= 5) return { season: "SPRING", year };
  if (m <= 8) return { season: "SUMMER", year };
  return { season: "FALL", year };
}

export function nextSeason(s = seasonOf()): { season: MediaSeason; year: number } {
  const order: MediaSeason[] = ["WINTER", "SPRING", "SUMMER", "FALL"];
  const i = order.indexOf(s.season);
  return i === 3 ? { season: "WINTER", year: s.year + 1 } : { season: order[i + 1], year: s.year };
}

export interface AnimeHome {
  trending: AnimeCard[];
  season: AnimeCard[];
  upcoming: AnimeCard[];
  top: AnimeCard[];
  popular: AnimeCard[];
  movies: AnimeCard[];
}

/** Every shelf on the Anime page, in one request. */
export function useAnimeHome() {
  return useQuery({ queryKey: ["anime", "home"], staleTime: 30 * 60_000, queryFn: fetchAnimeHome });
}

export async function fetchAnimeHome(): Promise<AnimeHome> {
  const now = seasonOf();
  const next = nextSeason(now);
  const page = (args: string) => `Page(perPage: 24) { media(type: ANIME, isAdult: false, ${args}) { ${LISTED} } }`;
  const data = await gql<Record<keyof AnimeHome, { media: AnimeCard[] }>>(
    `query ($season: MediaSeason, $year: Int, $nextSeason: MediaSeason, $nextYear: Int) {
      trending: ${page("sort: TRENDING_DESC")}
      season: ${page("season: $season, seasonYear: $year, sort: POPULARITY_DESC")}
      upcoming: ${page("season: $nextSeason, seasonYear: $nextYear, sort: POPULARITY_DESC")}
      top: ${page("sort: SCORE_DESC, popularity_greater: 20000")}
      popular: ${page("sort: POPULARITY_DESC")}
      movies: ${page("format: MOVIE, sort: POPULARITY_DESC")}
    }`,
    { season: now.season, year: now.year, nextSeason: next.season, nextYear: next.year },
  );
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.media])) as unknown as AnimeHome;
}

/** One shelf per genre, fetched when it scrolls near. */
export function useAnimeGenre(genre: string, enabled: boolean) {
  return useQuery({
    queryKey: ["anime", "genre", genre],
    staleTime: 60 * 60_000,
    enabled,
    queryFn: async () =>
      (
        await gql<{ Page: { media: AnimeCard[] } }>(
          `query ($genre: String) { Page(perPage: 24) { media(type: ANIME, isAdult: false, genre: $genre, sort: TRENDING_DESC) { ${LISTED} } } }`,
          { genre },
        )
      ).Page.media,
  });
}

export function useAnime(id: number) {
  return useQuery({ queryKey: ["anime", "media", id], staleTime: 30 * 60_000, queryFn: () => fetchAnime(id) });
}

export async function fetchAnime(id: number): Promise<Anime> {
  type Edge = CharacterEdge & { voiceActors?: (Person & { languageV2?: string })[] };
  const media = (
        await gql<{ Media: Anime & { characters: { edges: Edge[] } } }>(
          `query ($id: Int) {
            Media(id: $id, type: ANIME) {
              ${CARD}
              description(asHtml: false)
              synonyms source hashtag meanScore favourites isAdult countryOfOrigin
              endDate { year month day }
              trailer { id site }
              studios { edges { isMain node { id name isAnimationStudio } } }
              tags { name rank description isMediaSpoiler isGeneralSpoiler category }
              relations { edges { relationType(version: 2) node { ${CARD} } } }
              characters(sort: [ROLE, RELEVANCE, ID], perPage: 25) {
                edges {
                  role
                  node { id name { full native } image { large } }
                  voiceActors(sort: [RELEVANCE, ID]) { id name { full native } image { large } languageV2 }
                }
              }
              staff(sort: [RELEVANCE, ID], perPage: 12) { edges { role node { id name { full native } image { large } } } }
              recommendations(sort: [RATING_DESC, ID], perPage: 16) { nodes { mediaRecommendation { ${CARD} } } }
              externalLinks { site url type color icon language }
              rankings { rank type context allTime season year }
              airingSchedule(perPage: 50) { nodes { episode airingAt } }
            }
          }`,
          { id },
        )
      ).Media;
  // Aliasing `voiceActors` twice on one edge comes back merged, so ask once and split by language.
  for (const e of media.characters.edges) {
    const all = e.voiceActors ?? [];
    e.ja = all.filter((p) => p.languageV2 === "Japanese");
    e.en = all.filter((p) => p.languageV2 === "English");
    delete e.voiceActors;
  }
  // MAIN, then SUPPORTING, then BACKGROUND (AniList's ROLE sort puts them the other way round).
  const order = { MAIN: 0, SUPPORTING: 1, BACKGROUND: 2 };
  media.characters.edges.sort((a, b) => order[a.role] - order[b.role]);
  return media;
}

export interface AiringSlot {
  id: number;
  episode: number;
  airingAt: number;
  media: AnimeCard & { isAdult?: boolean; countryOfOrigin?: string | null };
}

/** Everything airing between two moments (unix seconds), in order. */
export function useAiringSchedule(from: number, to: number, enabled = true) {
  const { animeScheduleAll } = usePrefs();
  return useQuery({
    queryKey: ["anime", "schedule", from, to],
    staleTime: 10 * 60_000,
    enabled,
    // Never adult titles; the long tail of shorts nobody's tracking only if Settings → Anime asks.
    select: (slots: AiringSlot[]) => slots.filter((s) => !s.media.isAdult && (animeScheduleAll || (s.media.popularity ?? 0) >= 500)),
    queryFn: async () => {
      const out: AiringSlot[] = [];
      for (let page = 1; page <= 6; page++) {
        const data = await gql<{ Page: { pageInfo: { hasNextPage: boolean }; airingSchedules: AiringSlot[] } }>(
          `query ($page: Int, $from: Int, $to: Int) {
            Page(page: $page, perPage: 50) {
              pageInfo { hasNextPage }
              airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
                id episode airingAt media { ${LISTED} isAdult countryOfOrigin }
              }
            }
          }`,
          { page, from, to },
        );
        out.push(...data.Page.airingSchedules);
        if (!data.Page.pageInfo.hasNextPage) break;
      }
      return out;
    },
  });
}

/** Midnight today, in unix seconds. */
export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/** Today's airings in the viewer's time zone, one slot per show (a double episode day is still one show). */
export function useAiringToday(enabled = true) {
  const from = startOfToday();
  const q = useAiringSchedule(from, from + 86_400, enabled);
  const seen = new Set<number>();
  const slots = q.data?.filter((s) => !seen.has(s.media.id) && seen.add(s.media.id));
  return { slots, isError: q.isError };
}

export type BrowseSort = "TRENDING_DESC" | "POPULARITY_DESC" | "SCORE_DESC" | "START_DATE_DESC" | "TITLE_ROMAJI";

export interface BrowseFilters {
  search: string;
  genre: string;
  /** An AniList tag (Isekai, Shounen…): the anime-specific kinds genres don't cover. */
  tag: string;
  season: MediaSeason | "";
  year: number | 0;
  format: MediaFormat | "";
  status: MediaStatus | "";
  sort: BrowseSort;
}

/** The searchable, filterable grid. Infinite: 36 a page. */
export function useAnimeBrowse(f: BrowseFilters, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: ["anime", "browse", f],
    staleTime: 15 * 60_000,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const vars: Record<string, unknown> = { page: pageParam, sort: f.search ? ["SEARCH_MATCH", f.sort] : [f.sort] };
      if (f.search) vars.search = f.search;
      if (f.genre) vars.genre = f.genre;
      if (f.tag) vars.tag = f.tag;
      if (f.season) vars.season = f.season;
      if (f.year) vars.year = f.year;
      if (f.format) vars.format = f.format;
      if (f.status) vars.status = f.status;
      const data = await gql<{ Page: { pageInfo: { hasNextPage: boolean }; media: AnimeCard[] } }>(
        `query ($page: Int, $search: String, $genre: String, $tag: String, $season: MediaSeason, $year: Int, $format: MediaFormat, $status: MediaStatus, $sort: [MediaSort]) {
          Page(page: $page, perPage: 36) {
            pageInfo { hasNextPage }
            media(type: ANIME, isAdult: false, search: $search, genre: $genre, tag: $tag, season: $season, seasonYear: $year, format: $format, status: $status, sort: $sort) { ${CARD} }
          }
        }`,
        vars,
      );
      return data.Page;
    },
    getNextPageParam: (last, pages) => (last.pageInfo.hasNextPage ? pages.length + 1 : undefined),
  });
}

/** AniList tags worth browsing by: the anime-specific kinds of show. */
export const ANIME_TAGS = [
  "Isekai",
  "Shounen",
  "Seinen",
  "Shoujo",
  "Josei",
  "Iyashikei",
  "Super Power",
  "Martial Arts",
  "Military",
  "School",
  "Reincarnation",
  "Time Loop",
  "Vampire",
  "Cyberpunk",
  "Historical",
  "Survival",
  "Idol",
];

/** AniList's genres (stable; the API's GenreCollection minus Ecchi and Hentai). */
export const ANIME_GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Horror",
  "Mahou Shoujo",
  "Mecha",
  "Music",
  "Mystery",
  "Psychological",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
];
