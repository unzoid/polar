import { useQuery } from "@tanstack/react-query";
import type { Video } from "../types";

/**
 * ani.zip: the bridge between anime databases and everything else. For an
 * AniList id it knows the IMDb/TMDB/TVDB/MAL/Kitsu ids, and for every episode
 * its title, still, synopsis, air date and where it sits in TVDB's seasons.
 * That's what lets an AniList title play through the app's normal sources:
 * AniList splits a show into one entry per cour, IMDb keeps it as one show.
 */

export interface AniZipEpisode {
  episode: string;
  seasonNumber?: number;
  episodeNumber?: number;
  absoluteEpisodeNumber?: number;
  title?: Record<string, string | undefined>;
  airDate?: string;
  /** Older entries spell it this way. */
  airdate?: string;
  airDateUtc?: string;
  runtime?: number;
  length?: number;
  overview?: string;
  summary?: string;
  image?: string;
  rating?: string;
}

export interface AniZip {
  titles?: Record<string, string>;
  episodeCount?: number;
  specialCount?: number;
  images?: { coverType: "Banner" | "Poster" | "Fanart" | "Clearlogo"; url: string }[];
  mappings: {
    anilist_id?: number;
    mal_id?: number;
    kitsu_id?: number;
    imdb_id?: string | null;
    themoviedb_id?: string | number | null;
    thetvdb_id?: number | null;
    anidb_id?: number | null;
    type?: string;
  };
  episodes: Record<string, AniZipEpisode>;
}

export async function fetchAniZip(params: { anilist_id: number } | { imdb_id: string } | { kitsu_id: number }): Promise<AniZip | null> {
  const [k, v] = Object.entries(params)[0];
  const res = await fetch(`https://api.ani.zip/mappings?${k}=${encodeURIComponent(String(v))}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ani.zip answered ${res.status}`);
  const json = (await res.json()) as AniZip;
  return json?.mappings ? json : null;
}

export const aniZipQuery = (anilistId: number) => ({
  queryKey: ["anizip", anilistId],
  queryFn: () => fetchAniZip({ anilist_id: anilistId }),
  staleTime: 6 * 60 * 60_000,
  gcTime: 24 * 60 * 60_000,
  retry: 1,
});

export function useAniZip(anilistId: number, enabled = true) {
  return useQuery({ ...aniZipQuery(anilistId), enabled });
}

export const anizipImage = (z: AniZip | null | undefined, type: "Fanart" | "Clearlogo" | "Banner" | "Poster") =>
  z?.images?.find((i) => i.coverType === type)?.url;

/**
 * This entry's logo and backdrop. ani.zip's come from the whole TVDB series,
 * so every season, movie and OVA of a franchise would share one logo and one
 * picture: only the first season keeps them. The rest use AniList's own
 * banner for that entry, and their title as text.
 */
export function animeArt(
  a: { format?: string | null; bannerImage?: string | null; coverImage: { extraLarge?: string | null } },
  z: AniZip | null | undefined,
) {
  const season = regularEpisodes(z)[0]?.seasonNumber;
  const franchise = a.format !== "MOVIE" && (season == null || season <= 1);
  const own = a.bannerImage ?? a.coverImage.extraLarge ?? undefined;
  return {
    background: (franchise ? anizipImage(z, "Fanart") : undefined) ?? own ?? anizipImage(z, "Fanart"),
    logo: franchise ? anizipImage(z, "Clearlogo") : undefined,
  };
}

/** The regular episodes (not specials), in order. */
export function regularEpisodes(z: AniZip | null | undefined): AniZipEpisode[] {
  if (!z) return [];
  return Object.entries(z.episodes)
    .filter(([k]) => /^\d+$/.test(k))
    .map(([, e]) => e)
    .sort((a, b) => Number(a.episode) - Number(b.episode));
}

const DAY = 86_400_000;
const time = (iso?: string) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).getTime() : NaN);

/**
 * Which of the app's videos (one IMDb show, its own season numbering) is
 * this anime episode? Air date first: it survives every numbering scheme
 * (TVDB, TMDB and IMDb disagree on seasons for most long-running anime).
 * Then TVDB's season/episode, then position by absolute number.
 */
export function matchVideo(ep: AniZipEpisode, videos: Video[]): Video | undefined {
  const regular = videos.filter((v) => v.season > 0);
  const aired = time(ep.airDateUtc ?? ep.airDate ?? ep.airdate);
  if (Number.isFinite(aired)) {
    const near = regular.filter((v) => Math.abs(time(v.released) - aired) <= 1.5 * DAY);
    if (near.length === 1) return near[0];
    if (near.length > 1) {
      // Double-episode days: the one whose number lines up.
      const byNumber = near.find((v) => v.season === ep.seasonNumber && v.episode === ep.episodeNumber);
      if (byNumber) return byNumber;
      const sameDay = near.filter((v) => Math.abs(time(v.released) - aired) < DAY);
      const ordered = (sameDay.length ? sameDay : near).sort((a, b) => a.season - b.season || a.episode - b.episode);
      return ordered[0];
    }
  }
  if (ep.seasonNumber && ep.episodeNumber) {
    const exact = regular.find((v) => v.season === ep.seasonNumber && v.episode === ep.episodeNumber);
    if (exact) return exact;
  }
  if (ep.absoluteEpisodeNumber) {
    const ordered = [...regular].sort((a, b) => a.season - b.season || a.episode - b.episode);
    return ordered[ep.absoluteEpisodeNumber - 1];
  }
  return undefined;
}

/** An episode's title in the language from Settings → Anime, falling back to whatever it has. */
export function episodeTitle(ep: AniZipEpisode, lang: "romaji" | "english" | "native") {
  const { en, "x-jat": romaji, ja } = ep.title ?? {};
  if (lang === "native") return ja ?? romaji ?? en;
  if (lang === "romaji") return romaji ?? en ?? ja;
  return en ?? romaji ?? ja;
}
