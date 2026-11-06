import type { QueryClient } from "@tanstack/react-query";
import { cachedLookup } from "../net/queries";
import type { AnimeCard } from "./anilist";
import type { AniZip } from "./anizip";
import { animeEntries } from "./entries";
import { animeEpisodes } from "./episodes";

/**
 * Line an entry's episodes up with its title's videos, as the anime page does, and remember which
 * they are (lib/anime/entries.ts): for TV mode, which opens the title's own page, with seasons as
 * separate shows (#22). Never throws; an entry that can't be lined up stays unknown.
 */
export async function lineUpEntry(qc: QueryClient, anime: AnimeCard, zip: AniZip | null | undefined, metaId: string, titles: "romaji" | "english" | "native") {
  if (anime.format === "MOVIE") return;
  const meta = await cachedLookup(qc)
    .meta("series", metaId)
    .catch(() => null);
  if (!meta?.videos?.length) return;
  const imdb = metaId.startsWith("tt") ? metaId : undefined;
  const lined = animeEpisodes({ anime, zip, videos: meta.videos, imdb, titles }).flatMap((e): [string, number][] => (e.video ? [[e.video.id, e.number]] : []));
  animeEntries.remember(metaId, anime.id, { title: anime.title, cover: anime.coverImage.extraLarge ?? anime.coverImage.large }, lined);
}
