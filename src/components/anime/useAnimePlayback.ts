import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type { Anime, AnimeCard } from "../../lib/anime/anilist";
import { useAniZip } from "../../lib/anime/anizip";
import { animeEpisodes, progressByVideo, upNext } from "../../lib/anime/episodes";
import { linkAnime } from "../../lib/anime/links";
import { playContext } from "../../lib/anime/playContext";
import { useAnimeImdb } from "../../lib/anime/search";
import { rememberStill } from "../../lib/anime/stills";
import { usePrefs } from "../../lib/prefs";
import { useMeta, useProgress } from "../../lib/queries";
import { watchedFraction } from "../../lib/watched";

/**
 * Everything the anime page needs to play: the episodes, matched to the
 * app's videos, and where you're up to (lib/anime/episodes.ts). Also links
 * the entry to the id it plays from, and leaves the player what it can't
 * know itself (MAL numbering, Kitsu ids, stills).
 */
export function useAnimePlayback(anime: AnimeCard | Anime) {
  const { data: zip } = useAniZip(anime.id);
  const isMovie = anime.format === "MOVIE";
  const kitsu = zip?.mappings.kitsu_id;
  // ani.zip's IMDb show, unless its episodes stop before this entry's (then the
  // show that has them), or the same title on Cinemeta when ani.zip has no link.
  const { data: foundImdb, isPending: linking, isSuccess: imdbKnown } = useAnimeImdb(anime, zip);
  const imdb = foundImdb ?? undefined;
  // The app's id for this show: its IMDb page, or (for the many with none) its Kitsu id, which the stream addons know.
  const metaId = imdb ?? (kitsu ? `kitsu:${kitsu}` : undefined);
  const { data: meta, isLoading: metaLoading } = useMeta(isMovie ? "movie" : "series", metaId ?? "", !!metaId);
  const { data: progress } = useProgress(metaId ?? "");
  const malId = anime.idMal ?? zip?.mappings.mal_id;
  const { animeTitles } = usePrefs();

  const episodes = useMemo(() => animeEpisodes({ anime, zip, videos: meta?.videos ?? [], imdb, titles: animeTitles }), [zip, meta, anime, animeTitles, imdb]);

  // The id this entry plays from, for the backend: library and progress kept under its other ids move onto it.
  // Only once the IMDb lookup has answered, so a failed lookup doesn't link the entry to its Kitsu id.
  const qc = useQueryClient();
  useEffect(() => {
    if (metaId && imdbKnown) void linkAnime(qc, { canonical: metaId, anilist: anime.id, mal: malId, kitsu });
  }, [qc, metaId, imdbKnown, anime.id, malId, kitsu]);

  // AniSkip needs MyAnimeList's numbering, and stream addons know an IMDb-matched episode by its Kitsu id
  // too; the player can't know either. Leave them (kept across restarts) for every episode.
  useEffect(() => {
    for (const e of episodes) if (e.video && e.image) rememberStill(e.video.id, e.image);
    if (!metaId || !imdbKnown) return;
    const lined = episodes.flatMap((e): [string, number][] => (e.video ? [[e.video.id, e.number]] : []));
    playContext.remember(metaId, { mal: malId, kitsu }, lined);
  }, [episodes, malId, kitsu, metaId, imdbKnown]);

  const byVideo = useMemo(() => progressByVideo(progress ?? [], { episodes, imdb, kitsu, isMovie }), [progress, episodes, imdb, kitsu, isMovie]);
  const next = useMemo(() => upNext({ episodes, byVideo, isMovie, metaId, watched: watchedFraction() }), [episodes, byVideo, isMovie, metaId]);

  // Until ani.zip and the link are known, there's nothing to say about sources yet.
  const loading = zip === undefined || linking;
  return { zip, loading, metaId, meta, metaLoading, malId, episodes, byVideo, next, isMovie };
}
