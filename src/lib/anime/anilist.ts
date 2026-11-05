import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrefs } from "../settings/prefs";
import { keys } from "../net/queryKeys";
import { anilistLimiter, limitedFetch } from "../net/limiter";
import { isRecord, listOf, str } from "../parse";
import { readAnime, readLinked, readPage, readSlot } from "./responses";
import { walkSeasons } from "./seasons";
import { oneFranchiseEach } from "./franchise";
import { batcher } from "../net/batch";

/**
 * AniList (graphql.anilist.co): the anime catalogue, seasons, the airing
 * schedule, relations, characters and voice actors. Public and keyless.
 *
 * It rate-limits per IP (30–90 requests a minute), so the Anime page asks for
 * all of its shelves in one request, results are cached generously, and every
 * request goes through one shared budget that waits out a 429
 * (lib/net/limiter.ts).
 */
const ENDPOINT = "https://graphql.anilist.co";

/** The `data` of AniList's answer, unread: callers take what they asked for through lib/anime/responses.ts. */
export async function gql(query: string, variables: Record<string, unknown> = {}, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const res = await limitedFetch(anilistLimiter, ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    signal,
  });
  const json: unknown = await res.json().catch(() => null);
  const data = isRecord(json) && isRecord(json.data) ? json.data : undefined;
  if (!res.ok || !data) {
    const error = isRecord(json) && Array.isArray(json.errors) && isRecord(json.errors[0]) ? str(json.errors[0].message) : undefined;
    throw new Error(error ?? `AniList answered ${res.status}`);
  }
  return data;
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
  /** Its direct prequels and sequels: only on search results, to show a franchise once. */
  chain?: number[];
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

/** The prequel/sequel ids a list needs to show each franchise once (lib/anime/franchise.ts). */
const CHAIN = "relations { edges { relationType(version: 2) node { id } } }";

/** A card on the Anime page, where the carousel and the TV stage show its synopsis. */
const LISTED = `${CARD} description(asHtml: false) ${CHAIN}`;

/** A listed card with its prequel/sequel ids as `chain`. */
function readListed(hit: unknown): AnimeCard | undefined {
  const linked = readLinked(hit);
  if (!linked) return undefined;
  const { relations, ...card } = linked;
  return { ...card, chain: relations.edges.filter((e) => e.relationType === "PREQUEL" || e.relationType === "SEQUEL").map((e) => e.node.id) };
}
/** A list as one card per franchise. */
const listed = (v: unknown) => oneFranchiseEach(listOf(v, readListed));

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
  return useQuery({ queryKey: keys.anime.home, staleTime: 30 * 60_000, queryFn: ({ signal }) => fetchAnimeHome(signal) });
}

export async function fetchAnimeHome(signal?: AbortSignal): Promise<AnimeHome> {
  const now = seasonOf();
  const next = nextSeason(now);
  const page = (args: string) => `Page(perPage: 24) { media(type: ANIME, isAdult: false, ${args}) { ${LISTED} } }`;
  const data = await gql(
`query ($season: MediaSeason, $year: Int, $nextSeason: MediaSeason, $nextYear: Int) {
  trending: ${page("sort: TRENDING_DESC")}
  season: ${page("season: $season, seasonYear: $year, sort: POPULARITY_DESC")}
  upcoming: ${page("season: $nextSeason, seasonYear: $nextYear, sort: POPULARITY_DESC")}
  top: ${page("sort: SCORE_DESC, popularity_greater: 20000")}
  popular: ${page("sort: POPULARITY_DESC")}
  movies: ${page("format: MOVIE, sort: POPULARITY_DESC")}
}`,
{ season: now.season, year: now.year, nextSeason: next.season, nextYear: next.year },
signal,
  );
  const shelf = (k: keyof AnimeHome) => listed(isRecord(data[k]) ? data[k].media : undefined);
  return {
    trending: shelf("trending"),
    season: shelf("season"),
    upcoming: shelf("upcoming"),
    top: shelf("top"),
    popular: shelf("popular"),
    movies: shelf("movies"),
  };
}

/**
 * Genre shelves asked for close together (scrolling down the Anime page) go to AniList as one
 * request, a page per genre under its own alias: fewer requests against the rate limit, and the row
 * on screen no longer waits behind a queue of single ones (test report 1, item 21).
 */
const genreShelves = batcher(async (genres: string[]) => {
  const vars = Object.fromEntries(genres.map((g, i) => [`g${i}`, g]));
  const data = await gql(
    `query (${genres.map((_, i) => `$g${i}: String`).join(", ")}) {
      ${genres.map((_, i) => `g${i}: Page(perPage: 24) { media(type: ANIME, isAdult: false, genre: $g${i}, sort: TRENDING_DESC) { ${LISTED} } }`).join("\n")}
    }`,
    vars,
  );
  return genres.map((_, i) => {
    const page = data[`g${i}`];
    return listed(isRecord(page) ? page.media : undefined);
  });
});

/** One shelf per genre, fetched when it scrolls near (with any others asked for at the same time). */
export function useAnimeGenre(genre: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.anime.genre(genre),
    staleTime: 60 * 60_000,
    enabled,
    queryFn: () => genreShelves(genre),
  });
}

// --- Seasons ---------------------------------------------------------------

/** One step along a franchise: the entry, and where its prequel and sequel lead (with the entry's details when asked for). */
export interface ChainLink extends AnimeCard {
  relations: {
    edges: { relationType: RelationType; node: { id: number; type?: string | null; format?: MediaFormat | null; full?: ChainLink } }[];
  };
}

/**
 * A franchise's main entries in watch order (lib/anime/seasons.ts), so its seasons can sit side by
 * side like a show's. Each request brings the entry's neighbours with their own links, so a walk
 * takes half as many requests (each cached for a day). While steps fail (AniList busy), what was
 * found shows and the walk is tried again in a minute.
 */
export function useAnimeSeasons(anime: Anime | undefined) {
  const client = useQueryClient();
  return useQuery({
    queryKey: keys.anime.seasons(anime?.id),
    enabled: !!anime,
    staleTime: 6 * 60 * 60_000,
    refetchInterval: (q) => (q.state.data && !q.state.data.complete ? 60_000 : false),
    queryFn: () => {
      const link = (id: number) =>
        client.fetchQuery({
          queryKey: keys.anime.link(id),
          staleTime: 24 * 60 * 60_000,
          queryFn: async ({ signal }) => {
            const data = await gql(
              `query ($id: Int) { Media(id: $id, type: ANIME) { ${CARD} relations { edges { relationType(version: 2) node {
                ${CARD} relations { edges { relationType(version: 2) node { id type format } } } } } } } }`,
              { id },
              signal,
            );
            const linked = readLinked(data.Media);
            if (!linked) throw new Error(`AniList has no anime ${id}`);
            // The neighbours came whole: later walks through them start from the cache.
            for (const e of linked.relations.edges) if (e.node.full) client.setQueryData(keys.anime.link(e.node.id), e.node.full);
            return linked;
          },
        });
      return walkSeasons(anime!, link);
    },
  });
}

/**
 * An anime's full page data. `keepPrevious`: while another entry loads, keep
 * answering with the last one (a franchise page switching seasons in place
 * shouldn't collapse to a skeleton and lose its scroll position).
 */
export function useAnime(id: number, { keepPrevious = false } = {}) {
  return useQuery({
queryKey: keys.anime.media(id),
staleTime: 30 * 60_000,
queryFn: ({ signal }) => fetchAnime(id, signal),
placeholderData: keepPrevious ? keepPreviousData : undefined,
  });
}

export async function fetchAnime(id: number, signal?: AbortSignal): Promise<Anime> {
  const data = await gql(
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
    signal,
  );
  const media = readAnime(data.Media);
  if (!media) throw new Error(`AniList has no anime ${id}`);
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
    queryKey: keys.anime.schedule(from, to),
    staleTime: 10 * 60_000,
    enabled,
    // Never adult titles; the long tail of shorts nobody's tracking only if Settings → Anime asks.
    select: (slots: AiringSlot[]) => slots.filter((s) => !s.media.isAdult && (animeScheduleAll || (s.media.popularity ?? 0) >= 500)),
    queryFn: async ({ signal }) => {
      const out: AiringSlot[] = [];
      for (let page = 1; page <= 6; page++) {
        const data = await gql(
          `query ($page: Int, $from: Int, $to: Int) {
            Page(page: $page, perPage: 50) {
              pageInfo { hasNextPage }
              airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
                id episode airingAt media { ${LISTED} isAdult countryOfOrigin }
              }
            }
          }`,
          { page, from, to },
          signal,
        );
        const { items, hasNextPage } = readPage(data, "airingSchedules");
        out.push(...listOf(items, readSlot));
        if (!hasNextPage) break;
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
    queryKey: keys.anime.browse(f),
    staleTime: 15 * 60_000,
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => {
      const vars: Record<string, unknown> = { page: pageParam, sort: f.search ? ["SEARCH_MATCH", f.sort] : [f.sort] };
      if (f.search) vars.search = f.search;
      if (f.genre) vars.genre = f.genre;
      if (f.tag) vars.tag = f.tag;
      if (f.season) vars.season = f.season;
      if (f.year) vars.year = f.year;
      if (f.format) vars.format = f.format;
      if (f.status) vars.status = f.status;
      const data = await gql(
        `query ($page: Int, $search: String, $genre: String, $tag: String, $season: MediaSeason, $year: Int, $format: MediaFormat, $status: MediaStatus, $sort: [MediaSort]) {
          Page(page: $page, perPage: 36) {
            pageInfo { hasNextPage }
            media(type: ANIME, isAdult: false, search: $search, genre: $genre, tag: $tag, season: $season, seasonYear: $year, format: $format, status: $status, sort: $sort) {
              ${CARD} ${CHAIN}
            }
          }
        }`,
        vars,
        signal,
      );
      // Shown once per franchise (oneFranchiseEach, across pages by the grid): keep just the prequel/sequel links it needs.
      const { items, hasNextPage } = readPage(data, "media");
      const media = listOf(items, readListed);
      return { pageInfo: { hasNextPage }, media };
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
