/**
 * What AniList, ani.zip and AniSkip answer, read instead of cast (critique M9). Each reader keeps
 * what fits its type and drops the rest: a card without an id, an episode that isn't an object or a
 * relation of a kind the app doesn't know is left out, and a field of the wrong kind reads as
 * missing, so one odd entry never breaks a whole page. Type-only imports: nothing here touches the
 * network or the window, so tests load it as it is.
 */
import { isRecord, listOf, num, str, strings } from "../parse";
import type { Span } from "../types";
import type { Anime, AnimeCard, AnimeTag, ChainLink, CharacterEdge, FuzzyDate, MediaFormat, MediaSeason, MediaStatus, Person, RelationType } from "./anilist";
import type { AniZip, AniZipEpisode } from "./anizip";

type Rec = Record<string, unknown>;

/** A whole number > 0: an AniList, MAL, Kitsu, TVDB or AniDB id. */
export const id = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined);
/** A whole number ≥ 0: episode counts and numbers, unix times. */
const whole = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
const oneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): T | undefined =>
    values.includes(v as T) ? (v as T) : undefined;
/** `v`'s fields, or none. */
const rec = (v: unknown): Rec => (isRecord(v) ? v : {});
/** A connection's `edges` / `nodes`, each through `read`. */
const edges = <T>(v: unknown, read: (item: unknown) => T | undefined) => listOf(rec(v).edges, read);
const nodes = <T>(v: unknown, read: (item: unknown) => T | undefined) => listOf(rec(v).nodes, read);

// --- AniList -----------------------------------------------------------------

const FORMATS = ["TV", "TV_SHORT", "MOVIE", "SPECIAL", "OVA", "ONA", "MUSIC", "MANGA", "NOVEL", "ONE_SHOT"] as const satisfies readonly MediaFormat[];
const STATUSES = ["FINISHED", "RELEASING", "NOT_YET_RELEASED", "CANCELLED", "HIATUS"] as const satisfies readonly MediaStatus[];
const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const satisfies readonly MediaSeason[];
const RELATIONS = [
  "ADAPTATION",
  "PREQUEL",
  "SEQUEL",
  "PARENT",
  "SIDE_STORY",
  "CHARACTER",
  "SUMMARY",
  "ALTERNATIVE",
  "SPIN_OFF",
  "OTHER",
  "SOURCE",
  "COMPILATION",
  "CONTAINS",
] as const satisfies readonly RelationType[];
export const relationType = oneOf<RelationType>(RELATIONS);
const ROLES = ["MAIN", "SUPPORTING", "BACKGROUND"] as const;

function fuzzyDate(v: unknown): FuzzyDate | undefined {
  if (!isRecord(v)) return undefined;
  return { year: whole(v.year) ?? null, month: whole(v.month) ?? null, day: whole(v.day) ?? null };
}

/** A card: needs an id; everything else is optional and read as missing when it doesn't fit. */
export function readCard(v: unknown): AnimeCard | undefined {
  if (!isRecord(v)) return undefined;
  const cardId = id(v.id);
  if (cardId === undefined) return undefined;
  const title = rec(v.title);
  const cover = rec(v.coverImage);
  const next = rec(v.nextAiringEpisode);
  const episode = whole(next.episode);
  const airingAt = whole(next.airingAt);
  const card: AnimeCard = {
    id: cardId,
    idMal: id(v.idMal) ?? null,
    type: oneOf(["ANIME", "MANGA"] as const)(v.type),
    title: { romaji: str(title.romaji) ?? null, english: str(title.english) ?? null, native: str(title.native) ?? null },
    coverImage: { extraLarge: str(cover.extraLarge) ?? null, large: str(cover.large) ?? null, color: str(cover.color) ?? null },
    bannerImage: str(v.bannerImage) ?? null,
    format: oneOf(FORMATS)(v.format) ?? null,
    status: oneOf(STATUSES)(v.status) ?? null,
    episodes: whole(v.episodes) ?? null,
    duration: whole(v.duration) ?? null,
    season: oneOf(SEASONS)(v.season) ?? null,
    seasonYear: whole(v.seasonYear) ?? null,
    averageScore: num(v.averageScore) ?? null,
    popularity: whole(v.popularity) ?? null,
    genres: strings(v.genres),
    startDate: fuzzyDate(v.startDate),
    nextAiringEpisode: episode !== undefined && airingAt !== undefined ? { episode, airingAt, timeUntilAiring: num(next.timeUntilAiring) ?? 0 } : null,
  };
  if ("description" in v) card.description = str(v.description) ?? null;
  return card;
}

export const readCards = (v: unknown): AnimeCard[] => listOf(v, readCard);

/** A card and the entries it leads to by relation, each by id (and kind, where asked for). */
export function readLinked(v: unknown): ChainLink | undefined {
  const card = readCard(v);
  if (!card) return undefined;
  const relations = edges(rec(v).relations, (e) => {
    const r = rec(e);
    const node = rec(r.node);
    const relation = relationType(r.relationType);
    const nodeId = id(node.id);
    if (!relation || nodeId === undefined) return undefined;
    // Asked with its own details and links (the season walk), the entry comes whole.
    const full = isRecord(node.relations) ? readLinked(node) : undefined;
    return { relationType: relation, node: { id: nodeId, type: str(node.type) ?? null, format: oneOf(FORMATS)(node.format) ?? null, ...(full && { full }) } };
  });
  return { ...card, relations: { edges: relations } };
}

/** An airing slot: its own id, the episode, when, and the show (a card plus what the schedule filters by). */
export function readSlot(v: unknown) {
  const slot = rec(v);
  const media = readCard(slot.media);
  const slotId = id(slot.id);
  const episode = whole(slot.episode);
  const airingAt = whole(slot.airingAt);
  if (!media || slotId === undefined || episode === undefined || airingAt === undefined) return undefined;
  const m = rec(slot.media);
  return { id: slotId, episode, airingAt, media: { ...media, isAdult: bool(m.isAdult), countryOfOrigin: str(m.countryOfOrigin) ?? null } };
}

/** One page of a `Page { pageInfo { hasNextPage } … }` answer: the list under `field` and whether there's more. */
export function readPage(data: unknown, field: string): { hasNextPage: boolean; items: unknown } {
  const page = rec(rec(data).Page);
  return { hasNextPage: rec(page.pageInfo).hasNextPage === true, items: page[field] };
}

function person(v: unknown): Person | undefined {
  const p = rec(v);
  const name = rec(p.name);
  const personId = id(p.id);
  const full = str(name.full);
  if (personId === undefined || full === undefined) return undefined;
  const image = isRecord(p.image) ? { large: str(p.image.large) ?? null } : null;
  return { id: personId, name: { full, native: str(name.native) ?? null }, image };
}

/**
 * A character with their Japanese and English voices. AniList merges two aliases of
 * `voiceActors` on one edge, so it's asked for once and split here by language.
 */
function character(v: unknown): CharacterEdge | undefined {
  const e = rec(v);
  const node = person(e.node);
  if (!node) return undefined;
  const voices = listOf(e.voiceActors, (a) => {
    const p = person(a);
    return p && { person: p, language: str(rec(a).languageV2) };
  });
  return {
    role: oneOf(ROLES)(e.role) ?? "BACKGROUND",
    node,
    ja: voices.filter((x) => x.language === "Japanese").map((x) => x.person),
    en: voices.filter((x) => x.language === "English").map((x) => x.person),
  };
}

function tag(v: unknown): AnimeTag | undefined {
  const t = rec(v);
  const name = str(t.name);
  if (name === undefined) return undefined;
  return {
    name,
    rank: num(t.rank) ?? 0,
    description: str(t.description) ?? null,
    isMediaSpoiler: t.isMediaSpoiler === true,
    isGeneralSpoiler: t.isGeneralSpoiler === true,
    category: str(t.category) ?? null,
  };
}

/** An anime's whole page; characters MAIN first, then SUPPORTING, then BACKGROUND (AniList's ROLE sort is the other way round). */
export function readAnime(v: unknown): Anime | undefined {
  const card = readCard(v);
  if (!card) return undefined;
  const m = rec(v);
  const trailer = rec(m.trailer);
  const order = { MAIN: 0, SUPPORTING: 1, BACKGROUND: 2 };
  return {
    ...card,
    description: str(m.description) ?? null,
    synonyms: strings(m.synonyms),
    source: str(m.source) ?? null,
    hashtag: str(m.hashtag) ?? null,
    endDate: fuzzyDate(m.endDate),
    meanScore: num(m.meanScore) ?? null,
    favourites: whole(m.favourites) ?? null,
    isAdult: bool(m.isAdult),
    countryOfOrigin: str(m.countryOfOrigin) ?? null,
    trailer: str(trailer.id) && str(trailer.site) ? { id: trailer.id as string, site: trailer.site as string } : null,
    studios: {
      edges: edges(m.studios, (e) => {
        const node = rec(rec(e).node);
        const studioId = id(node.id);
        const name = str(node.name);
        if (studioId === undefined || name === undefined) return undefined;
        return { isMain: rec(e).isMain === true, node: { id: studioId, name, isAnimationStudio: node.isAnimationStudio === true } };
      }),
    },
    tags: listOf(m.tags, tag),
    relations: {
      edges: edges(m.relations, (e) => {
        const relation = relationType(rec(e).relationType);
        const node = readCard(rec(e).node);
        return relation && node && { relationType: relation, node };
      }),
    },
    characters: { edges: edges(m.characters, character).sort((a, b) => order[a.role] - order[b.role]) },
    staff: {
      edges: edges(m.staff, (e) => {
        const node = person(rec(e).node);
        return node && { role: str(rec(e).role) ?? "", node };
      }),
    },
    recommendations: { nodes: nodes(m.recommendations, (n) => (isRecord(n) ? { mediaRecommendation: readCard(n.mediaRecommendation) ?? null } : undefined)) },
    externalLinks: listOf(m.externalLinks, (l) => {
      const r = rec(l);
      const site = str(r.site);
      const url = str(r.url);
      if (site === undefined || url === undefined) return undefined;
      return { site, url, type: str(r.type) ?? null, color: str(r.color) ?? null, icon: str(r.icon) ?? null, language: str(r.language) ?? null };
    }),
    rankings: listOf(m.rankings, (x) => {
      const r = rec(x);
      const rank = whole(r.rank);
      const type = oneOf(["RATED", "POPULAR"] as const)(r.type);
      if (rank === undefined || !type) return undefined;
      return {
        rank,
        type,
        context: str(r.context) ?? "",
        allTime: r.allTime === true,
        season: oneOf(SEASONS)(r.season) ?? null,
        year: whole(r.year) ?? null,
      };
    }),
    airingSchedule: {
      nodes: nodes(m.airingSchedule, (n) => {
        const episode = whole(rec(n).episode);
        const airingAt = whole(rec(n).airingAt);
        return episode !== undefined && airingAt !== undefined ? { episode, airingAt } : undefined;
      }),
    },
  };
}

// --- ani.zip -----------------------------------------------------------------

const COVER_TYPES = ["Banner", "Poster", "Fanart", "Clearlogo"] as const;

/** A map of strings: titles by language. Values that aren't strings are left out. */
function texts(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, s] of Object.entries(rec(v))) if (typeof s === "string") out[k] = s;
  return out;
}

function episode(key: string, v: unknown): AniZipEpisode | undefined {
  if (!isRecord(v)) return undefined;
  return {
    episode: str(v.episode) ?? key,
    seasonNumber: whole(v.seasonNumber),
    episodeNumber: whole(v.episodeNumber),
    absoluteEpisodeNumber: whole(v.absoluteEpisodeNumber),
    title: isRecord(v.title) ? texts(v.title) : undefined,
    airDate: str(v.airDate),
    airdate: str(v.airdate),
    airDateUtc: str(v.airDateUtc),
    runtime: num(v.runtime),
    length: num(v.length),
    overview: str(v.overview),
    summary: str(v.summary),
    image: str(v.image),
    rating: str(v.rating) ?? (num(v.rating) === undefined ? undefined : String(v.rating)),
  };
}

/** ani.zip's record, or `null` when the answer has no mappings (it doesn't know the show). */
export function readAniZip(v: unknown): AniZip | null {
  if (!isRecord(v) || !isRecord(v.mappings)) return null;
  const m = v.mappings;
  const tmdb = m.themoviedb_id;
  const episodes: Record<string, AniZipEpisode> = {};
  for (const [k, e] of Object.entries(rec(v.episodes))) {
    const read = episode(k, e);
    if (read) episodes[k] = read;
  }
  return {
    titles: isRecord(v.titles) ? texts(v.titles) : undefined,
    episodeCount: whole(v.episodeCount),
    specialCount: whole(v.specialCount),
    images: listOf(v.images, (i) => {
      const coverType = oneOf(COVER_TYPES)(rec(i).coverType);
      const url = str(rec(i).url);
      return coverType && url !== undefined ? { coverType, url } : undefined;
    }),
    mappings: {
      anilist_id: id(m.anilist_id),
      mal_id: id(m.mal_id),
      kitsu_id: id(m.kitsu_id),
      imdb_id: str(m.imdb_id) ?? null,
      themoviedb_id: str(tmdb) ?? id(tmdb) ?? null,
      thetvdb_id: id(m.thetvdb_id) ?? null,
      anidb_id: id(m.anidb_id) ?? null,
      type: str(m.type),
    },
    episodes,
  };
}

// --- AniSkip -----------------------------------------------------------------

/** AniSkip's segments that can be used: a kind, and a span that ends after it starts. */
export function readSkipTimes(v: unknown): { kind: string; span: Span }[] {
  const r = rec(v);
  if (r.found !== true) return [];
  return listOf(r.results, (x) => {
    const kind = str(rec(x).skipType);
    const interval = rec(rec(x).interval);
    const start = num(interval.startTime);
    const end = num(interval.endTime);
    return kind !== undefined && start !== undefined && end !== undefined && start >= 0 && end > start ? { kind, span: { start, end } } : undefined;
  });
}
