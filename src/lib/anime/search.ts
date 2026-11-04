import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { cachedLookup } from "../queries";
import { ANIME_GENRES, ANIME_TAGS, gql, useAnimeBrowse, type AnimeCard } from "./anilist";
import { airedEpisodes, airsWith, fetchAniZip, type AniZip, type AniZipEpisode } from "./anizip";
import { norm } from "./merge";
import { keys } from "../queryKeys";

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

/** {@link imdbForAnime} for a page, once ani.zip has answered. */
export function useAnimeImdb(a: AnimeCard, zip: AniZip | null | undefined) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.anime.imdb(a.id),
    enabled: zip !== undefined,
    staleTime: 6 * 60 * 60_000,
    queryFn: () => imdbForAnime(a, zip ?? null, cachedLookup(qc)),
  });
}

/** Where titles and episode lists come from: the app's addons, or a caller's cached copy of them. */
export type Lookup = { search: typeof api.search; meta: typeof api.meta };

/**
 * The IMDb show to play an AniList entry from.
 *
 * ani.zip links an entry to its TVDB series' IMDb id. Usually that show has
 * the entry's episodes, but IMDb sometimes lists a later part as a show of
 * its own: TVDB has Paleblade: Hundred-Night Ash War as season 17 of Paleblade,
 * IMDb (and so Cinemeta) as a separate show, and Paleblade's episodes stop in
 * 2012. So when none of the entry's aired episodes are in the linked show,
 * the show that does have them is looked up by title instead. With no link
 * at all, the title search is the only way (new seasons often have neither
 * an IMDb nor a Kitsu id on ani.zip yet).
 *
 * Null: nothing to play from IMDb. An entry ani.zip links only to Kitsu
 * plays by its Kitsu id, so it isn't searched for.
 */
export async function imdbForAnime(a: AnimeCard, zip: AniZip | null, lookup: Lookup = api): Promise<string | null> {
  const linked = zip?.mappings.imdb_id || undefined;
  if (!linked && zip?.mappings.kitsu_id) return null;
  const aired = a.format === "MOVIE" ? [] : airedEpisodes(zip);
  if (linked) {
    // Nothing aired to check by, or the linked show has it: keep ani.zip's link.
    if (!aired.length) return linked;
    const videos = (await lookup.meta("series", linked).catch(() => null))?.videos;
    if (!videos || aired.some((e) => airsWith(e, videos))) return linked;
  }
  return (await findImdbId(a, aired, linked, lookup)) ?? linked ?? null;
}

/**
 * Titles to look an entry up by on Cinemeta: its own, then without a part
 * name ("… - The Parting", "… Part 2", "… 2nd Season"), since IMDb often
 * keeps a season's parts as one show.
 */
export function lookupTitles(a: Pick<AnimeCard, "title">): string[] {
  const own = [a.title.english, a.title.romaji].filter((t): t is string => !!t);
  const base = own.map((t) =>
    t
      .replace(/\s+[-–—]\s+[^-–—]+$/, "")
      .replace(/[\s:]+(?:(?:part|cour|season)\s*\d+|\d+(?:st|nd|rd|th)\s+season)$/i, "")
      .trim(),
  );
  return [...new Set([...own, ...base])].filter((t) => norm(t).length > 1);
}

/**
 * Cinemeta's show for an anime, by title (any of AniList's, then without a
 * part name). A series whose episodes have aired must have most of them, by
 * air date: that's what proves it's the right show, so a title without the
 * part name or a year that's off (the third part of a show that began two
 * years earlier) still counts. Otherwise the same title and a year that
 * agrees. `exclude`: a show already known not to be it.
 */
export async function findImdbId(
  a: AnimeCard,
  aired: AniZipEpisode[] = [],
  exclude?: string,
  lookup: Lookup = api,
): Promise<string | null> {
  const type = a.format === "MOVIE" ? "movies" : "series";
  const year = a.seasonYear ?? a.startDate?.year ?? undefined;
  const tried = new Set<string>(exclude ? [exclude] : []);
  for (const t of lookupTitles(a)) {
    const named = (await lookup.search(t))[type].filter((m) => m.id.startsWith("tt") && norm(m.name) === norm(t));
    for (const m of named) {
      if (tried.has(m.id)) continue;
      tried.add(m.id);
      if (type === "series" && aired.length) {
        const videos = (await lookup.meta("series", m.id).catch(() => null))?.videos ?? [];
        if (aired.filter((e) => airsWith(e, videos)).length * 2 >= aired.length) return m.id;
      } else {
        const y = Number(m.releaseInfo?.match(/\d{4}/)?.[0]);
        if (!year || !y || Math.abs(y - year) <= 1) return m.id;
      }
    }
  }
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
