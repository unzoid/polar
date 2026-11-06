/**
 * A franchise's newest part that AniList splits into entries ("… - 1st Leg", "… - 2nd & 3rd Leg")
 * while ani.zip (TVDB) keeps it as one run of episodes under the first entry, numbered across both.
 * Pure: type-only imports.
 */
import type { Anime, AnimeCard, FuzzyDate } from "./anilist";
import type { AniZip, AniZipEpisode } from "./anizip";

/** A title without its part name: "Show: Arc - 1st Leg" is "Show: Arc". The title itself when it has none. */
export function withoutPartName(title: string | null | undefined): string {
  return (title ?? "").replace(/\s+[-–—]\s+[^-–—]+$/, "").trim();
}

/**
 * Whether two entries are parts of one split entry: both carry a part name, and without it their
 * titles are the same, in English or in romaji.
 */
export function sameSplitEntry(a: Pick<AnimeCard, "title">, b: Pick<AnimeCard, "title">): boolean {
  return (["english", "romaji"] as const).some((lang) => {
    const [x, y] = [a.title[lang], b.title[lang]];
    const base = withoutPartName(x);
    return !!x && !!y && base.length > 2 && base !== x && base === withoutPartName(y) && withoutPartName(y) !== y;
  });
}

const DAY = 86_400_000;
const dayOf = (d: FuzzyDate | null | undefined) => (d?.year && d.month && d.day ? Date.UTC(d.year, d.month - 1, d.day) : undefined);
const airedAt = (e: AniZipEpisode) => new Date(e.airDateUtc ?? e.airDate ?? e.airdate ?? NaN).getTime();

/**
 * The ani.zip record to show this entry's episodes with.
 *
 * A finished entry whose record lists more episodes than it has, the extra ones airing after it
 * ended (they are its next part's), keeps only its own.
 *
 * An entry ani.zip knows nothing about (no ids, no episodes) whose direct prequel's record goes on
 * past where the prequel ended borrows those episodes: the ones that air with this entry's own
 * schedule, numbered as AniList numbers them, or without a schedule the ones from its first day,
 * numbered from 1. The IMDb, TMDB and TVDB show come along; the Kitsu and MAL ids are the prequel's
 * own, so they don't.
 */
export function entryZip(anime: AnimeCard | Anime, own: AniZip | null | undefined, prequel?: AniZip | null): AniZip | null | undefined {
  const ended = "endDate" in anime ? dayOf(anime.endDate) : undefined;
  if (own && anime.status === "FINISHED" && anime.episodes && ended !== undefined) {
    const entries = Object.entries(own.episodes);
    const regular = entries.filter(([k]) => /^\d+$/.test(k));
    if (regular.length > anime.episodes) {
      const later = new Set(regular.filter(([, e]) => airedAt(e) > ended + 2 * DAY).map(([k]) => k));
      if (later.size && regular.length - later.size <= anime.episodes) return { ...own, episodes: Object.fromEntries(entries.filter(([k]) => !later.has(k))) };
    }
  }
  if (own === undefined) return own;
  if (!knowsNothing(own) || !prequel) return own;

  const regular = Object.values(prequel.episodes).filter((e) => /^\d+$/.test(e.episode));
  const schedule = "airingSchedule" in anime ? anime.airingSchedule.nodes : [];
  const borrowed: AniZipEpisode[] = [];
  if (schedule.length) {
    for (const e of regular) {
      const s = schedule.find((s) => Math.abs(s.airingAt * 1000 - airedAt(e)) <= 1.5 * DAY);
      if (s) borrowed.push({ ...e, episode: String(s.episode) });
    }
  } else {
    const from = dayOf(anime.startDate);
    if (from !== undefined)
      regular
        .filter((e) => airedAt(e) >= from - DAY)
        .sort((a, b) => Number(a.episode) - Number(b.episode))
        .forEach((e, i) => borrowed.push({ ...e, episode: String(i + 1) }));
  }
  if (!borrowed.length) return own;
  const { imdb_id, themoviedb_id, thetvdb_id, type } = prequel.mappings;
  return {
    ...own,
    mappings: { anilist_id: anime.id, imdb_id, themoviedb_id, thetvdb_id, type },
    episodes: Object.fromEntries(borrowed.map((e) => [e.episode, e])),
  };
}

/** An ani.zip answer with nothing to go on: no record, or one without ids or episodes. */
export const knowsNothing = (z: AniZip | null) => !z || (!z.mappings.imdb_id && !z.mappings.kitsu_id && !Object.keys(z.episodes).length);

/** The direct prequel whose ani.zip record an entry may borrow episodes from (`entryZip`). */
export function prequelOf(anime: AnimeCard | Anime): number | undefined {
  if (!("relations" in anime)) return undefined;
  return anime.relations.edges.find((e) => e.relationType === "PREQUEL" && e.node.type !== "MANGA")?.node.id;
}
