import type { SkipSegments, Span } from "../types";
import { fetchAniZip, regularEpisodes } from "./anizip";

/**
 * AniSkip (api.aniskip.com): crowd-sourced opening, ending and recap times
 * for anime, by MyAnimeList id and episode number. IntroDB rarely knows
 * anime; AniSkip has most of what's aired in the last decade.
 *
 * The player only knows the app's video id (tt…:season:episode). Episodes
 * started from the Anime page leave their MAL id and number here, so the
 * lookup is exact; for anything else, ani.zip's IMDb mapping fills in where
 * the numbering can't be ambiguous.
 */
const context = new Map<string, { malId: number; episode: number }>();

export function rememberAnimeEpisode(videoId: string, malId: number, episode: number) {
  context.set(videoId, { malId, episode });
}

async function resolve(videoId: string): Promise<{ malId: number; episode: number } | null> {
  const known = context.get(videoId);
  if (known) return known;
  const [imdb, s, e] = videoId.split(":");
  if (!imdb?.startsWith("tt") || !s || !e) return null;
  const season = Number(s);
  const episode = Number(e);
  const zip = await fetchAniZip({ imdb_id: imdb }).catch(() => null);
  const malId = zip?.mappings.mal_id;
  if (!zip || !malId) return null;
  // ani.zip answers with the show's first AniList entry, numbered by TVDB. Only
  // trust it where that entry has this exact season and episode.
  const ep = regularEpisodes(zip).find((x) => x.seasonNumber === season && x.episodeNumber === episode);
  return ep ? { malId, episode: Number(ep.episode) } : null;
}

interface AniSkipResult {
  found: boolean;
  results?: { interval: { startTime: number; endTime: number }; skipType: "op" | "ed" | "recap" | "mixed-op" | "mixed-ed" }[];
}

export async function aniSkipSegments(videoId: string): Promise<Partial<SkipSegments>> {
  const target = await resolve(videoId);
  if (!target) return {};
  const types = ["op", "ed", "recap", "mixed-op", "mixed-ed"].map((t) => `types=${t}`).join("&");
  const res = await fetch(`https://api.aniskip.com/v2/skip-times/${target.malId}/${target.episode}?${types}&episodeLength=0`).catch(() => null);
  if (!res?.ok) return {};
  const json = (await res.json()) as AniSkipResult;
  if (!json.found || !json.results) return {};
  const span = (kinds: string[]): Span | undefined => {
    const r = json.results!.find((x) => kinds.includes(x.skipType));
    return r && r.interval.endTime > r.interval.startTime ? { start: r.interval.startTime, end: r.interval.endTime } : undefined;
  };
  const out: Partial<SkipSegments> = {};
  const intro = span(["op", "mixed-op"]);
  const outro = span(["ed", "mixed-ed"]);
  const recap = span(["recap"]);
  if (intro) out.intro = intro;
  if (outro) out.outro = outro;
  if (recap) out.recap = recap;
  return out;
}
