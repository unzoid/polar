import type { Anime, AnimeCard } from "./anilist";
import { alignByAirDate, episodeTitle, matchVideo, regularEpisodes, type AniZip, type AniZipEpisode } from "./anizip";
import { formatTime } from "../format";
import type { Progress, Video } from "../types";

/**
 * The anime page's playback model, without React: its episodes matched to
 * the app's videos, progress kept under the show's Kitsu id carried over to
 * its IMDb episodes, and which episode is up next. `useAnimePlayback`
 * (components/anime/useAnimePlayback.ts) feeds it the queries.
 */

export interface AnimeEpisode {
  /** The episode's number in this entry. */
  number: number;
  /** Counted from the start of the show (ani.zip's, from TVDB), when known. */
  absolute?: number;
  title?: string;
  image?: string;
  overview?: string;
  /** ISO date or date-time. */
  airDate?: string;
  runtime?: number;
  video?: Video;
  upcoming: boolean;
}

/**
 * Every regular episode of the entry, from ani.zip (or numbered from AniList
 * when ani.zip has none), plus the ones AniList has scheduled that ani.zip
 * doesn't list yet, each with its video when there's one to play.
 */
export function animeEpisodes({
  anime,
  zip,
  videos,
  imdb,
  titles,
  now = Date.now(),
}: {
  anime: AnimeCard | Anime;
  zip: AniZip | null | undefined;
  videos: Video[];
  /** The IMDb show the videos are from; absent when they're a Kitsu show's. */
  imdb?: string;
  titles: "romaji" | "english" | "native";
  now?: number;
}): AnimeEpisode[] {
  if (anime.format === "MOVIE") return [];
  // A Kitsu show's videos are numbered like the anime's; an IMDb one's are matched by air date.
  // ani.zip's numbers (TVDB's seasons) only apply to the show ani.zip links; another show is lined up by air date.
  const byImdb = imdb === zip?.mappings.imdb_id ? (e: AniZipEpisode) => matchVideo(e, videos) : alignByAirDate(regularEpisodes(zip), videos);
  const videoFor = (e: AniZipEpisode) => (!videos.length ? undefined : imdb ? byImdb(e) : videos.find((v) => v.episode === Number(e.episode)));
  const fromZip = regularEpisodes(zip).map((e: AniZipEpisode): AnimeEpisode => {
    const airDate = e.airDateUtc ?? e.airDate ?? e.airdate;
    return {
      number: Number(e.episode),
      ...(e.absoluteEpisodeNumber !== undefined && { absolute: e.absoluteEpisodeNumber }),
      title: episodeTitle(e, titles),
      image: e.image,
      overview: e.overview ?? e.summary,
      airDate,
      runtime: e.runtime ?? e.length,
      video: videoFor(e),
      upcoming: !!airDate && new Date(airDate).getTime() > now,
    };
  });
  const list = fromZip.length
    ? fromZip
    : Array.from({ length: anime.episodes ?? Math.max(0, (anime.nextAiringEpisode?.episode ?? 1) - 1) }, (_, i): AnimeEpisode => ({
        number: i + 1,
        upcoming: false,
        video: videoFor({ episode: String(i + 1) } as AniZipEpisode),
      }));
  // Episodes AniList has scheduled that ani.zip doesn't list yet.
  const scheduled = "airingSchedule" in anime ? anime.airingSchedule.nodes : [];
  const have = new Set(list.map((e) => e.number));
  for (const s of scheduled) {
    const airDate = new Date(s.airingAt * 1000).toISOString();
    const upcoming = s.airingAt * 1000 > now;
    // Airing shows ani.zip hasn't caught up with: the aired ones still need
    // their video, or they'd be dropped from the shelf as unplayable.
    const video = upcoming ? undefined : videoFor({ episode: String(s.episode), airDateUtc: airDate } as AniZipEpisode);
    if (!have.has(s.episode)) list.push({ number: s.episode, airDate, upcoming, video });
    else {
      const e = list.find((x) => x.number === s.episode)!;
      if (upcoming) e.upcoming = true;
      e.airDate ??= airDate;
      e.video ??= video;
    }
  }
  return list.sort((a, b) => a.number - b.number);
}

/**
 * Progress by video id. Episodes played under the show's Kitsu id before it
 * was linked to its IMDb page are the same episodes: the newer record wins.
 */
export function progressByVideo(
  progress: Progress[],
  { episodes, imdb, kitsu, isMovie }: { episodes: AnimeEpisode[]; imdb?: string; kitsu?: number; isMovie: boolean },
) {
  const m = new Map(progress.map((p) => [p.videoId, p]));
  const alias = (from: string, to: string) => {
    const p = m.get(from);
    const q = m.get(to);
    if (p && (!q || p.updatedAt > q.updatedAt)) m.set(to, p);
  };
  if (imdb && kitsu) {
    for (const e of episodes) if (e.video) alias(`kitsu:${kitsu}:${e.number}`, e.video.id);
    if (isMovie) alias(`kitsu:${kitsu}`, imdb);
  }
  return m;
}

export interface UpNext {
  ep?: AnimeEpisode;
  /** Seconds in, when it resumes. */
  resumeAt?: number;
  kind: "resume" | "next" | "start";
}

/** Past this many seconds an unfinished episode resumes; before it, it plays again from the top. */
const RESUME_FROM = 30;

/** Up next: carry on from the episode you touched last. `watched` is the fraction that counts as seen. */
export function upNext({
  episodes,
  byVideo,
  isMovie,
  metaId,
  watched,
}: {
  episodes: AnimeEpisode[];
  byVideo: Map<string, Progress>;
  isMovie: boolean;
  metaId?: string;
  watched: number;
}): UpNext {
  const done = (p?: Progress) => !!p && p.duration > 0 && p.position / p.duration >= watched;
  if (isMovie) {
    const p = metaId ? byVideo.get(metaId) : undefined;
    const resumeAt = p && !done(p) && p.position > RESUME_FROM ? p.position : undefined;
    return { resumeAt, kind: resumeAt ? "resume" : "start" };
  }
  const playable = episodes.filter((e) => e.video && !e.upcoming);
  const touched = playable
    .map((e) => ({ e, p: byVideo.get(e.video!.id) }))
    .filter((x) => x.p)
    .sort((a, b) => b.p!.updatedAt - a.p!.updatedAt)[0];
  if (touched) {
    if (!done(touched.p)) {
      // Unfinished: resume it, or (barely started) play it again from the top.
      return touched.p!.position > RESUME_FROM ? { ep: touched.e, resumeAt: touched.p!.position, kind: "resume" } : { ep: touched.e, kind: "next" };
    }
    const after = playable.find((e) => e.number > touched.e.number);
    if (after) return { ep: after, kind: "next" };
  }
  return { ep: playable[0], kind: "start" };
}

/** The Play button's words for what `upNext` chose. */
export function upNextLabel(next: UpNext, isMovie: boolean) {
  if (isMovie) return next.resumeAt ? `Resume · ${formatTime(next.resumeAt)}` : "Play";
  const ep = next.ep;
  if (!ep) return "Play";
  if (next.kind === "resume") return `Resume Episode ${ep.number}`;
  if (next.kind === "next") return `Play Episode ${ep.number}`;
  return ep.number === 1 ? "Play First Episode" : `Play Episode ${ep.number}`;
}
