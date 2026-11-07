import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { usePrefs } from "../settings/prefs";
import { keys } from "../net/queryKeys";
import { anilistLimiter, limitedFetch, PRIORITY, type Priority } from "../net/limiter";
import { readCached, writeCached } from "../net/deviceCache";
import { isRecord, listOf, str } from "../parse";
import { id as idOf, readAnime, readChained, readLinked, readPage, readRecommendations, readSlot } from "./responses";
import { walkSeasons, type SeasonWalk } from "./seasons";
import { cardsShown } from "./franchise";

/**
 * AniList (graphql.anilist.co): the anime catalogue, seasons, the airing
 * schedule, relations, characters and voice actors. Public and keyless.
 *
 * It rate-limits per IP (30–90 requests a minute), so the Anime page asks for
 * all of its shelves in one request, results are cached generously, and every
 * request goes through one shared budget that waits out a 429 and lets the
 * most urgent request go first (lib/net/limiter.ts, #109). The answers rows and
 * pages are drawn from are also kept on the device (lib/net/deviceCache.ts), so
 * they draw at once on the next visit and the next start.
 */
const ENDPOINT = "https://graphql.anilist.co";

/** How long the Anime page's rows, and an entry's page, are drawn from the device before they must be asked again. */
const ROWS_ON_DEVICE = 12 * 60 * 60_000;
const PAGE_ON_DEVICE = 24 * 60 * 60_000;

/** One request's place on the device: the query's text (hashed) with its variables. */
function deviceKey(query: string, variables: Record<string, unknown>) {
  let h = 0x811c9dc5;
  for (let i = 0; i < query.length; i++) h = Math.imul(h ^ query.charCodeAt(i), 0x01000193);
  return `anilist.${(h >>> 0).toString(36)}.${JSON.stringify(variables)}`;
}

export interface Ask {
  /** How urgent it is (lib/net/limiter.ts); on screen by default. */
  priority?: Priority;
  /** Keep the answer on the device for {@link fromDevice}. */
  keep?: boolean;
}

/** The `data` of AniList's answer, unread: callers take what they asked for through lib/anime/responses.ts. */
export async function gql(
  query: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal,
  { priority, keep = false }: Ask = {},
): Promise<Record<string, unknown>> {
  const res = await limitedFetch(
    anilistLimiter,
    ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      signal,
    },
    { priority },
  );
  const json: unknown = await res.json().catch(() => null);
  const data = isRecord(json) && isRecord(json.data) ? json.data : undefined;
  if (!res.ok || !data) {
    const error = isRecord(json) && Array.isArray(json.errors) && isRecord(json.errors[0]) ? str(json.errors[0].message) : undefined;
    throw new Error(error ?? `AniList answered ${res.status}`);
  }
  if (keep) writeCached(deviceKey(query, variables), data);
  return data;
}

/**
 * A query's `initialData` from what the device kept of the same request (read once, through
 * `read` like a fresh answer), with when it came: React Query draws it at once and asks again in
 * the background once it's older than the query's `staleTime`.
 */
function fromDevice<T>(query: string, variables: Record<string, unknown>, maxAge: number, read: (data: Record<string, unknown>) => T | undefined) {
  let seed: { data: T | undefined; at: number | undefined } | undefined;
  const get = () => {
    if (!seed) {
      const kept = readCached(deviceKey(query, variables), maxAge);
      const data = kept && isRecord(kept.data) ? read(kept.data) : undefined;
      seed = { data, at: data === undefined ? undefined : kept?.at };
    }
    return seed;
  };
  return { initialData: () => get().data, initialDataUpdatedAt: () => get().at };
}

const subscribeBusy = (listener: () => void) => anilistLimiter.subscribe(listener);
const isBusy = () => anilistLimiter.busy;

/** AniList is holding requests back (a 429's pause, or its reduced limit) long enough to say so on screen. */
export function useAniListBusy() {
  return useSyncExternalStore(subscribeBusy, isBusy);
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
  /** Only on an anime page's relations (#192), and the page itself: its official links, a YouTube video among them. */
  externalLinks?: { site: string; url: string }[];
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
  /** AniList's recommendations, best rated first; `rating` is its users' net votes, `hasNextPage` whether more were left. */
  recommendations: { nodes: { rating: number; mediaRecommendation: AnimeCard | null }[]; hasNextPage?: boolean };
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

/** An entry's recommendations, a page at a time: each card with its rating and the prequel/sequel ids "If You Liked This" groups by (#191). */
const RECS_PER_PAGE = 16;
const RECS = `pageInfo { hasNextPage } nodes { rating mediaRecommendation { ${CARD} ${CHAIN} } }`;

/** A card on the Anime page, where the carousel and the TV stage show its synopsis. */
const LISTED = `${CARD} description(asHtml: false) ${CHAIN}`;

/** A listed card with its prequel/sequel ids as `chain`. */
const readListed = readChained;
/** A list as it came: each entry with its prequel/sequel ids, grouped into franchises where it's shown ({@link useCardsShown}). */
const listed = (v: unknown) => listOf(v, readListed);

/** Lists as the cards to show, by the setting ({@link cardsShown}); stable while the setting stays, so a query's `select` keeps its result. */
export function useCardsShown() {
  const { animeSeparateEntries } = usePrefs();
  return useCallback(<T extends AnimeCard>(items: T[]) => cardsShown(items, animeSeparateEntries), [animeSeparateEntries]);
}

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

/** Every shelf on the Anime page, in one request; drawn from the device at once when it kept them. */
export function useAnimeHome() {
  const shown = useCardsShown();
  const select = useCallback(
    (home: AnimeHome): AnimeHome => ({
      trending: shown(home.trending),
      season: shown(home.season),
      upcoming: shown(home.upcoming),
      top: shown(home.top),
      popular: shown(home.popular),
      movies: shown(home.movies),
    }),
    [shown],
  );
  const seed = useMemo(() => fromDevice(HOME_QUERY, homeVariables(), ROWS_ON_DEVICE, readHome), []);
  return useQuery({ queryKey: keys.anime.home, staleTime: 30 * 60_000, queryFn: ({ signal }) => fetchAnimeHome(signal), select, ...seed });
}

const homePage = (args: string) => `Page(perPage: 24) { media(type: ANIME, isAdult: false, ${args}) { ${LISTED} } }`;
const HOME_QUERY = `query ($season: MediaSeason, $year: Int, $nextSeason: MediaSeason, $nextYear: Int) {
  trending: ${homePage("sort: TRENDING_DESC")}
  season: ${homePage("season: $season, seasonYear: $year, sort: POPULARITY_DESC")}
  upcoming: ${homePage("season: $nextSeason, seasonYear: $nextYear, sort: POPULARITY_DESC")}
  top: ${homePage("sort: SCORE_DESC, popularity_greater: 20000")}
  popular: ${homePage("sort: POPULARITY_DESC")}
  movies: ${homePage("format: MOVIE, sort: POPULARITY_DESC")}
}`;

function homeVariables() {
  const now = seasonOf();
  const next = nextSeason(now);
  return { season: now.season, year: now.year, nextSeason: next.season, nextYear: next.year };
}

export async function fetchAnimeHome(signal?: AbortSignal): Promise<AnimeHome> {
  return readHome(await gql(HOME_QUERY, homeVariables(), signal, { keep: true }));
}

function readHome(data: Record<string, unknown>): AnimeHome {
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

/** A genre shelf's first cards: a small answer that comes quickly, so the row fills from the left (re-test 21). */
export const GENRE_FIRST = 8;
/** The whole shelf, asked for once the first cards are in. */
const GENRE_ALL = 24;

const genreQuery = (perPage: number) =>
  `query ($genre: String) {
      Page(perPage: ${perPage}) { media(type: ANIME, isAdult: false, genre: $genre, sort: TRENDING_DESC) { ${LISTED} } }
    }`;
const readShelf = (data: Record<string, unknown>) => listed(isRecord(data.Page) ? data.Page.media : undefined);

/** A genre's shelf, trending first: `perPage` entries, in a request of its own. The whole row is kept on the device. */
export async function genreShelf(genre: string, perPage: number, signal?: AbortSignal, priority?: Priority): Promise<AnimeCard[] | undefined> {
  return readShelf(await gql(genreQuery(perPage), { genre }, signal, { priority, keep: perPage === GENRE_ALL }));
}

const level = (p: Priority) => (typeof p === "function" ? p() : p);

/** A row's priority from where it is on the page (lib/ui/viewport.ts useViewportPlace): far away it's background work. */
export const rowPriority = (place: "in" | "near" | "far") => (place === "in" ? PRIORITY.visible : place === "near" ? PRIORITY.near : PRIORITY.background);

/** A row moved: AniList's queue looks at the priorities again. */
export const reprioritiseAniList = () => anilistLimiter.wake();

/**
 * One shelf per genre, fetched when it scrolls near. Each shelf is its own request and shows as soon
 * as it's in, never waiting for another (re-test 21: one request for several rows made all of them
 * wait for the slowest); its first cards come first, the rest of the row right after, behind every
 * row's first cards. While AniList is degraded the row comes in one request instead of two (#109).
 * `priority`: where the row is (lib/net/limiter.ts), read when its request's turn comes. A row the
 * device kept draws at once and refreshes once it's an hour old.
 */
export function useAnimeGenre(genre: string, enabled: boolean, priority: Priority = PRIORITY.visible) {
  const qc = useQueryClient();
  const shown = useCardsShown();
  const select = useCallback((cards: AnimeCard[] | undefined) => cards && shown(cards), [shown]);
  const seed = useMemo(() => fromDevice(genreQuery(GENRE_ALL), { genre }, ROWS_ON_DEVICE, readShelf), [genre]);
  const haveAll = seed.initialData() !== undefined || qc.getQueryData(keys.anime.genre(genre)) !== undefined;
  const first = useQuery({
    queryKey: keys.anime.genreFirst(genre),
    staleTime: 60 * 60_000,
    enabled: enabled && !haveAll,
    queryFn: async ({ signal }) => {
      if (!anilistLimiter.reduced) return genreShelf(genre, GENRE_FIRST, signal, priority);
      const all = await genreShelf(genre, GENRE_ALL, signal, priority);
      if (all) qc.setQueryData(keys.anime.genre(genre), all);
      return all;
    },
    select,
  });
  const all = useQuery({
    queryKey: keys.anime.genre(genre),
    staleTime: 60 * 60_000,
    enabled: enabled && (haveAll || first.isFetched),
    queryFn: ({ signal }) => genreShelf(genre, GENRE_ALL, signal, () => level(priority) + 0.5),
    select,
    ...seed,
  });
  return { data: all.data ?? first.data, isError: first.isError && all.isError };
}

/**
 * A wide picture for each genre or tag (the phone's Search tiles): the banner of its most popular entry, or
 * its cover where none of the first few has one. One request for them all, asked again after a day.
 */
export function useAnimeGenreArt(names: string[], enabled = true) {
  return useQuery({
    queryKey: keys.anime.genreArt(names),
    staleTime: 24 * 60 * 60_000,
    enabled: enabled && names.length > 0,
    queryFn: async ({ signal }) => {
      const params = names.map((_, i) => `$n${i}: String`).join(", ");
      const pages = names.map(
        (n, i) =>
          `g${i}: Page(perPage: 4) { media(type: ANIME, isAdult: false, ${ANIME_TAGS.includes(n) ? "tag" : "genre"}: $n${i}, sort: POPULARITY_DESC) { bannerImage coverImage { extraLarge } } }`,
      );
      const vars = Object.fromEntries(names.map((n, i) => [`n${i}`, n]));
      const data = await gql(`query (${params}) { ${pages.join(" ")} }`, vars, signal, { priority: PRIORITY.visible });
      const art: Record<string, string> = {};
      names.forEach((n, i) => {
        const page = data[`g${i}`];
        const media = listOf(isRecord(page) ? page.media : undefined, (m) => (isRecord(m) ? m : undefined));
        const cover = (m: Record<string, unknown>) => (isRecord(m.coverImage) ? str(m.coverImage.extraLarge) : undefined);
        const pick = media.map((m) => str(m.bannerImage)).find(Boolean) ?? media.map(cover).find(Boolean);
        if (pick) art[n] = pick;
      });
      return art;
    },
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
  return useQuery(seasonsQuery(useQueryClient(), anime));
}

/** The query behind {@link useAnimeSeasons}, for walking several franchises at once (the Anime tab's banner, #325). */
export function seasonsQuery(client: QueryClient, anime: Anime | undefined) {
  return {
    queryKey: keys.anime.seasons(anime?.id),
    enabled: !!anime,
    staleTime: 6 * 60 * 60_000,
    refetchInterval: (q: { state: { data?: SeasonWalk } }) => (q.state.data && !q.state.data.complete ? 60_000 : false),
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
  };
}

/**
 * An anime's full page data. `keepPrevious`: while another entry loads, keep
 * answering with the last one (a franchise page switching seasons in place
 * shouldn't collapse to a skeleton and lose its scroll position).
 */
export function useAnime(id: number, { keepPrevious = false } = {}) {
  useEffect(() => {
    opened.set(id, (opened.get(id) ?? 0) + 1);
    // A hover may have queued this entry's details as background work: they go first now.
    anilistLimiter.wake();
    return () => {
      const n = (opened.get(id) ?? 1) - 1;
      if (n) opened.set(id, n);
      else opened.delete(id);
    };
  }, [id]);
  return useQuery({ ...animeQuery(id), placeholderData: keepPrevious ? keepPreviousData : undefined });
}

/** Entries whose page is open (how many times), so their details go first whoever asked for them (#109). */
const opened = new Map<number, number>();

/** An entry's page data as a query: kept on the device a day, drawn from it at once. */
export function animeQuery(id: number, priority: Priority = PRIORITY.page) {
  return {
    queryKey: keys.anime.media(id),
    staleTime: 30 * 60_000,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchAnime(id, signal, priority),
    ...fromDevice(ANIME_QUERY, { id }, PAGE_ON_DEVICE, (data) => readAnime(data.Media)),
  };
}

/**
 * Warms an entry's page data (the pointer rests on its card) as background work, moved to the
 * front if the page opens before it's in.
 */
export function prefetchAnime(qc: QueryClient, id: number) {
  return qc.prefetchQuery(animeQuery(id, () => (opened.has(id) ? PRIORITY.page : PRIORITY.background)));
}

/** The AniList id of MyAnimeList's anime `mal` (a MyAnimeList page opened in Polarity, #208); null when AniList has none. */
export async function anilistForMal(mal: number, signal?: AbortSignal): Promise<number | null> {
  let data: Record<string, unknown>;
  try {
    data = await gql("query ($mal: Int) { Media(idMal: $mal, type: ANIME) { id } }", { mal }, signal, { priority: PRIORITY.page });
  } catch (e) {
    // AniList answers 404 for an id it doesn't know.
    if ((e as Error).message === "Not Found.") return null;
    throw e;
  }
  return idOf(isRecord(data.Media) ? data.Media.id : undefined) ?? null;
}

export async function fetchAnime(id: number, signal?: AbortSignal, priority: Priority = PRIORITY.page): Promise<Anime> {
  const data = await gql(ANIME_QUERY, { id }, signal, { priority, keep: true });
  const media = readAnime(data.Media);
  if (!media) throw new Error(`AniList has no anime ${id}`);
  return media;
}

const ANIME_QUERY = `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${CARD}
        description(asHtml: false)
        synonyms source hashtag meanScore favourites isAdult countryOfOrigin
        endDate { year month day }
        trailer { id site }
        studios { edges { isMain node { id name isAnimationStudio } } }
        tags { name rank description isMediaSpoiler isGeneralSpoiler category }
        relations { edges { relationType(version: 2) node { ${CARD} externalLinks { site url } } } }
        characters(sort: [ROLE, RELEVANCE, ID], perPage: 25) {
          edges {
            role
            node { id name { full native } image { large } }
            voiceActors(sort: [RELEVANCE, ID]) { id name { full native } image { large } languageV2 }
          }
        }
        staff(sort: [RELEVANCE, ID], perPage: 12) { edges { role node { id name { full native } image { large } } } }
        recommendations(sort: [RATING_DESC, ID], perPage: ${RECS_PER_PAGE}) { ${RECS} }
        externalLinks { site url type color icon language }
        rankings { rank type context allTime season year }
        airingSchedule(perPage: 50) { nodes { episode airingAt } }
      }
    }`;

/**
 * An entry's second page of recommendations, for when grouping by franchise left its first too few to
 * fill the row (lib/anime/likedThis.ts).
 */
export function useMoreRecommendations(id: number, enabled: boolean) {
  return useQuery({
    queryKey: keys.anime.moreRecommendations(id),
    staleTime: 30 * 60_000,
    enabled,
    queryFn: async ({ signal }) => {
      const data = await gql(
        `query ($id: Int) { Media(id: $id, type: ANIME) { recommendations(sort: [RATING_DESC, ID], page: 2, perPage: ${RECS_PER_PAGE}) { ${RECS} } } }`,
        { id },
        signal,
        { priority: PRIORITY.near },
      );
      return readRecommendations(isRecord(data.Media) ? data.Media.recommendations : undefined);
    },
  });
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
      // Shown once per franchise unless seasons are separate shows (cardsShown, across pages by the grid): keep just the prequel/sequel links it needs.
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
