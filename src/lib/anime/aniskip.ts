import type { SkipSegments, Span } from "../types";
import { parseVideoId } from "../library/identity";
import { cachedAniZip, regularEpisodes } from "./anizip";
import { animeLinks } from "./links";
import { playContext } from "./playContext";
import { readSkipTimes } from "./responses";

/**
 * AniSkip (api.aniskip.com): crowd-sourced opening, ending and recap times
 * for anime, by MyAnimeList id and episode number. IntroDB rarely knows
 * anime; AniSkip has most of what's aired in the last decade.
 *
 * The player only knows the app's video id (tt…:season:episode). Episodes
 * the Anime page lined up have their MAL id and number in playContext, so
 * the lookup is exact; a Kitsu episode (`kitsu:N:E`) is numbered like MAL,
 * and its MAL id is in the show's anime link; for anything else, ani.zip's
 * IMDb mapping fills in where the numbering can't be ambiguous.
 */
async function resolve(videoId: string): Promise<{ malId: number; episode: number } | null> {
  const known = playContext.episode(videoId);
  if (known?.mal) return { malId: known.mal, episode: known.episode };
  const v = parseVideoId(videoId);
  if (v?.title.kind === "kitsu" && v.episode !== undefined) {
    const kitsu = Number(v.title.value);
    const link = (await animeLinks()).find((l) => l.kitsu === kitsu && l.mal);
    return link ? { malId: link.mal!, episode: v.episode } : null;
  }
  if (v?.title.kind !== "imdb" || v.episode === undefined) return null;
  const imdb = v.title.value;
  const season = v.season ?? 1;
  const episode = v.episode;
  const zip = await cachedAniZip({ imdb_id: imdb }).catch(() => null);
  const malId = zip?.mappings.mal_id;
  if (!zip || !malId) return null;
  // ani.zip answers with the show's first AniList entry, numbered by TVDB. Only
  // trust it where that entry has this exact season and episode.
  const ep = regularEpisodes(zip).find((x) => x.seasonNumber === season && x.episodeNumber === episode);
  return ep ? { malId, episode: Number(ep.episode) } : null;
}

export async function aniSkipSegments(videoId: string): Promise<Partial<SkipSegments>> {
  const target = await resolve(videoId);
  if (!target) return {};
  const types = ["op", "ed", "recap", "mixed-op", "mixed-ed"].map((t) => `types=${t}`).join("&");
  const res = await fetch(`https://api.aniskip.com/v2/skip-times/${target.malId}/${target.episode}?${types}&episodeLength=0`).catch(() => null);
  if (!res?.ok) return {};
  const found = readSkipTimes(await res.json().catch(() => null));
  const span = (kinds: string[]): Span | undefined => found.find((x) => kinds.includes(x.kind))?.span;
  const out: Partial<SkipSegments> = {};
  const intro = span(["op", "mixed-op"]);
  const outro = span(["ed", "mixed-ed"]);
  const recap = span(["recap"]);
  if (intro) out.intro = intro;
  if (outro) out.outro = outro;
  if (recap) out.recap = recap;
  return out;
}
