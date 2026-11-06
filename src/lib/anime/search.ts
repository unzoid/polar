import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { call } from "../platform/bridge";
import { cachedLookup } from "../net/queries";
import { ANIME_GENRES, ANIME_TAGS, animeQuery, gql, useAnimeBrowse, useCardsShown, type AnimeCard, type BrowseFilters } from "./anilist";
import { airedEpisodes, airsWith, cachedAniZip, type AniZip, type AniZipEpisode } from "./anizip";
import { animeLinks } from "./links";
import { norm } from "./merge";
import { readCards, readPage } from "./responses";
import { keys } from "../net/queryKeys";

const browse = (search: string, genre = "", tag = ""): BrowseFilters => ({ search, genre, tag, season: "", year: 0, format: "", status: "", sort: "POPULARITY_DESC" });

/**
 * AniList's answer to a search: a genre or kind of show if it names one, otherwise a title search.
 * AniList's search is strict where Cinemeta's forgives a typo: when it finds nothing, `retry` (the
 * title of an animated show Cinemeta found for the same words) is searched for instead, so the
 * anime still comes up as itself (test report 1, items 1 and 28). `retryTitle` picks it.
 */
export function useAnimeResults(query: string, retry?: string) {
  const lower = query.toLowerCase();
  const genre = ANIME_GENRES.find((g) => g.toLowerCase() === lower);
  const tag = genre ? undefined : ANIME_TAGS.find((t) => t.toLowerCase() === lower);
  const q = useAnimeBrowse(genre || tag ? browse("", genre, tag) : browse(query), !!query);
  const first = q.data?.pages[0]?.media;
  const again = !genre && !tag && !!retry && retry.toLowerCase() !== lower && first?.length === 0;
  const q2 = useAnimeBrowse(browse(retry ?? ""), again);
  const retried = q2.data?.pages[0]?.media;
  const items = again ? retried && retryMatches(retried, retry!) : first;
  const searched = again ? retry! : query;
  const shown = useCardsShown();
  return {
    title: genre || tag ? `${genre ?? tag} Anime` : "Anime",
    items: items && shown(genre || tag ? items : byRelevance(items, searched)),
    /** Every entry found, before one per franchise: what hides the same shows' Cinemeta results (a later part listed on its own, test report 1, item 10). */
    all: items,
    loading: !!query && (q.isLoading || (again && q2.isLoading)),
    /** The search failed (not "found nothing"): the row says so, with a retry. */
    failed: !!query && (again ? q2.isError : q.isError),
    retry: () => void (again ? q2.refetch() : q.refetch()),
  };
}


type Found = { name: string; genres?: string[] };

/**
 * What to ask AniList for when the typed words find nothing: the first animated show or film the
 * catalogs found, else their first show, else their first film. Catalog search answers often carry
 * no genres at all (re-test 28), so the first result is the best guess there; `retryMatches` keeps
 * that guess from bringing unrelated anime.
 */
export function retryTitle(series: Found[], movies: Found[]): string | undefined {
  const all = [...series, ...movies];
  return (all.find((m) => m.genres?.some((g) => /^anim(e|ation)$/i.test(g))) ?? series[0] ?? movies[0])?.name;
}

/** The entries AniList found for a guessed title that are named like it (any title starts with it). */
export function retryMatches(items: AnimeCard[], retry: string): AnimeCard[] {
  const q = norm(retry);
  return items.filter((a) => [a.title.romaji, a.title.english, a.title.native].some((t) => !!q && norm(t).startsWith(q)));
}

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

/** {@link animeImdb} for a page, once ani.zip has answered: with the entry's other names (synonyms) once AniList has them. */
export function useAnimeImdb(a: AnimeCard, zip: AniZip | null | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.anime.imdb(a.id),
    enabled: zip !== undefined,
    staleTime: 6 * 60 * 60_000,
    queryFn: async () => {
      const full: Titled = "synonyms" in a ? a : await qc.fetchQuery(animeQuery(a.id)).catch(() => a);
      return animeImdb(full, zip ?? null, cachedLookup(qc));
    },
  });
}

/** Where titles and episode lists come from: the app's addons, or a caller's cached copy of them. */
export type Lookup = { search: typeof api.search; meta: typeof api.meta };

/**
 * The links an entry may have besides ani.zip's: the id lists' IMDb id (Fribb/anime-lists, which
 * sometimes has a new show before ani.zip does), and the IMDb id stored for it: the one the user
 * picked, or one a title search found before (docs/anime-identity.md).
 */
export type Links = { listed: (anilist: number) => Promise<string | null>; stored: (anilist: number) => Promise<string | undefined> };

const savedLinks: Links = {
  listed: (anilist) =>
    call<{ imdb_id?: string | null } | null>("anime_ids", { key: "anilist_id", value: String(anilist) })
      .then((m) => m?.imdb_id || null)
      .catch(() => null),
  stored: async (anilist) => (await animeLinks()).find((l) => l.anilist === anilist && l.canonical.startsWith("tt"))?.canonical,
};

/** An entry with whatever names AniList gave it: a card has three, a page's details the synonyms too. */
export type Titled = AnimeCard & { synonyms?: string[] };

/**
 * The IMDb show an entry plays from, and how it was found: `mapping` (a public mapping's link, or the
 * show with its episodes when that link stops short), `stored` (picked by the user, or found by title
 * before) or `title` (a title search, with no mapping to go by). Only `stored` and `title` can be
 * wrong in a way the user can see and fix, so the page offers to change those.
 */
export type AnimeImdb = { id: string; by: "mapping" | "stored" | "title" } | null;

/** {@link animeImdb}'s id alone. */
export async function imdbForAnime(a: Titled, zip: AniZip | null, lookup: Lookup = api, links: Links = savedLinks): Promise<string | null> {
  return (await animeImdb(a, zip, lookup, links))?.id ?? null;
}

/**
 * The IMDb show to play an AniList entry from.
 *
 * ani.zip links an entry to its TVDB series' IMDb id. Usually that show has
 * the entry's episodes, but IMDb sometimes lists a later part as a show of
 * its own: TVDB has Paleblade: Hundred-Night Ash War as season 17 of Paleblade,
 * IMDb (and so Cinemeta) as a separate show, and Paleblade's episodes stop in
 * 2012. So when none of the entry's aired episodes are in the linked show,
 * the show that does have them is looked up by title instead. And a part
 * with a part name ("… - 1st Stage", "… 2nd - 3rd Stage") that IMDb lists as
 * a series of its own, named like the part without that name, plays from that
 * series even when the linked show has its episodes too (#78): its episodes
 * are matched by air date, the first part's as the series' first episodes.
 *
 * With no IMDb link on ani.zip, the id lists may have one. With none at all
 * (a new show often has neither an IMDb nor a Kitsu id yet), the link stored
 * for the entry is used, and failing that a title search (#189).
 *
 * Null: nothing to play from IMDb. An entry ani.zip links only to Kitsu
 * plays by its Kitsu id, so it isn't searched for.
 */
export async function animeImdb(a: Titled, zip: AniZip | null, lookup: Lookup = api, links: Links = savedLinks): Promise<AnimeImdb> {
  if (!zip?.mappings.imdb_id && zip?.mappings.kitsu_id) return null;
  const linked = zip?.mappings.imdb_id || (await links.listed(a.id)) || undefined;
  const aired = a.format === "MOVIE" ? [] : airedEpisodes(zip);
  if (linked) {
    // Nothing aired to check by, or the linked show has it: keep the link.
    if (!aired.length) return { id: linked, by: "mapping" };
    const show = await lookup.meta("series", linked).catch(() => null);
    const videos = show?.videos;
    if (!videos) return { id: linked, by: "mapping" };
    if (aired.some((e) => airsWith(e, videos))) return { id: (await ownSeries(a, aired, { id: linked, name: show?.name }, lookup)) ?? linked, by: "mapping" };
    return { id: (await findImdbId(a, aired, linked, lookup)) ?? linked, by: "mapping" };
  }
  const stored = await links.stored(a.id);
  if (stored) return { id: stored, by: "stored" };
  const found = await findImdbId(a, aired, undefined, lookup);
  return found ? { id: found, by: "title" } : null;
}

/**
 * Titles to look an entry up by on Cinemeta: its own, then without a part
 * name ("… - The Parting", "… Part 2", "… 2nd Season"), since IMDb often
 * keeps a season's parts as one show, then its other names (AniList's
 * synonyms, often the name it's known by in English) and its native title.
 */
export function lookupTitles(a: Pick<Titled, "title" | "synonyms">): string[] {
  const own = [a.title.english, a.title.romaji].filter((t): t is string => !!t);
  const base = own.map(withoutPart);
  const other = [...(a.synonyms ?? []), a.title.native].filter((t): t is string => !!t);
  const all = [...own, ...base, ...other].filter((t) => norm(t).length > 1);
  // Two titles that only differ in case or punctuation are one search.
  return all.filter((t, i) => all.findIndex((u) => norm(u) === norm(t)) === i);
}

/**
 * A title without its part name: "… - 1st Stage", "… 2nd - 3rd Stage", "… 2nd & 3rd Leg", "… - The
 * Parting", "… Part 2", "… 2nd Season". The title itself when it has none.
 */
export function withoutPart(title: string): string {
  return title
    .replace(/(?:\s*[-–—:])?\s+\d+(?:st|nd|rd|th)(?:\s*(?:[-–—&]|and)\s*\d+(?:st|nd|rd|th))?\s+(?:stage|leg|part|cour|season)s?$/i, "")
    .replace(/\s+[-–—]\s+[^-–—]+$/, "")
    .replace(/[\s:]+(?:(?:part|cour|season)\s*\d+|\d+(?:st|nd|rd|th)\s+season)$/i, "")
    .trim();
}

/**
 * The series of its own IMDb lists a part under (#78), when the linked show (`show`) has its episodes
 * too: searched for only by the entry's titles without their part name, leaving out the linked show's
 * own name, and taken only when it has most of the aired episodes by air date. An entry without a part
 * name isn't searched for. Null when there's none, or the search fails: the linked show stays.
 */
async function ownSeries(a: Titled, aired: AniZipEpisode[], show: { id: string; name?: string }, lookup: Lookup): Promise<string | null> {
  const own = [a.title.english, a.title.romaji].filter((t): t is string => !!t);
  const parts = own
    .filter((t) => norm(withoutPart(t)) !== norm(t))
    .map(withoutPart)
    .filter((t) => norm(t).length > 1 && norm(t) !== norm(show.name));
  if (!parts.length) return null;
  return findImdbId(a, aired, show.id, lookup, { titles: parts, dated: true }).catch(() => null);
}

/** How many different titles a lookup searches for at most: each is a request to the catalogs. */
const MAX_SEARCHES = 6;

/**
 * Cinemeta's show for an anime, by title (any of AniList's, then without a
 * part name, then its synonyms and native title). A result counts when its
 * name is any of those titles. A series whose episodes have aired must then
 * have most of them, by air date: that's what proves it's the right show, so
 * a title without the part name or a year that's off (the third part of a
 * show that began two years earlier) still counts. Otherwise, and for a
 * series Cinemeta has no dated episodes for yet (a show that started this
 * week), a year that agrees. `exclude`: a show already known not to be it.
 * Throws only when every search failed, so an offline lookup isn't taken
 * for "no such show".
 */
export async function findImdbId(
  a: Titled,
  aired: AniZipEpisode[] = [],
  exclude?: string,
  lookup: Lookup = api,
  /** `titles`: search only these. `dated`: only a series with most of the aired episodes counts. */
  only: { titles?: string[]; dated?: boolean } = {},
): Promise<string | null> {
  const type = a.format === "MOVIE" ? "movies" : "series";
  const year = a.seasonYear ?? a.startDate?.year ?? undefined;
  const tried = new Set<string>(exclude ? [exclude] : []);
  const all = lookupTitles(a);
  const titles = (only.titles ?? all).filter((t, i, ts) => ts.findIndex((u) => norm(u) === norm(t)) === i).slice(0, MAX_SEARCHES);
  const names = new Set([...all, ...titles].map(norm));
  let failed: unknown;
  let answered = false;
  for (const t of titles) {
    const results = await lookup.search(t).catch((e: unknown) => {
      failed ??= e;
      return null;
    });
    if (!results) continue;
    answered = true;
    const named = results[type].filter((m) => m.id.startsWith("tt") && names.has(norm(m.name)));
    for (const m of named) {
      if (tried.has(m.id)) continue;
      tried.add(m.id);
      const y = Number(m.releaseInfo?.match(/\d{4}/)?.[0]);
      const sameYear = !year || !y || Math.abs(y - year) <= 1;
      if (type === "series" && aired.length) {
        const videos = (await lookup.meta("series", m.id).catch(() => null))?.videos ?? [];
        if (aired.filter((e) => airsWith(e, videos)).length * 2 >= aired.length) return m.id;
        if (sameYear && !only.dated && !videos.some((v) => v.released)) return m.id;
      } else if (sameYear) return m.id;
    }
  }
  if (!answered && failed !== undefined) throw failed;
  return null;
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
  const zip = await cachedAniZip({ imdb_id: imdbId });
  const id = zip?.mappings.anilist_id;
  if (!id) return null;
  const formats: readonly string[] = title.type === "movie" ? MAIN_FORMATS.movie : MAIN_FORMATS.series;
  if (!zip.mappings.type || formats.includes(zip.mappings.type)) return id;

  const data = await gql(
    `query ($search: String, $formats: [MediaFormat]) {
      Page(perPage: 6) { media(type: ANIME, search: $search, format_in: $formats, sort: [SEARCH_MATCH, POPULARITY_DESC]) { id startDate { year } } }
    }`,
    { search: title.name, formats },
  ).catch(() => null);
  const candidates = readCards(data && readPage(data, "media").items).sort(
    (a, b) => Number(a.startDate?.year !== title.year) - Number(b.startDate?.year !== title.year),
  );
  for (const c of candidates.slice(0, 3)) {
    const z = await cachedAniZip({ anilist_id: c.id }).catch(() => null);
    if (z?.mappings.imdb_id === imdbId) return c.id;
  }
  return null;
}
