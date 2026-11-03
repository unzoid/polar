import type { ContentType, Meta, Video } from "../types";
import { getPrefs } from "../prefs";
import { fetchAnime } from "./anilist";
import { animeArt, episodeTitle, fetchAniZip, regularEpisodes } from "./anizip";
import { cleanDescription, pickTitle } from "./format";

/**
 * Anime with no IMDb page. Many shows (most donghua, plenty of ONAs and OVAs)
 * aren't on IMDb as a series ani.zip can map to, but stream addons such as
 * addon and Comet know them by Kitsu id: `kitsu:48036:5` is episode 5 of
 * Renegade Immortal. For these the app's own id is the Kitsu one, and this
 * builds the title page's data (what a metadata addon would send) from AniList
 * and ani.zip, so the title page, the player, watch history and the library
 * treat them like any other show.
 */
export const isKitsuId = (id: string) => id.startsWith("kitsu:");

/** Episode number out of "kitsu:48036:5" (undefined for the title itself). */
export const kitsuParts = (id: string) => {
  const [, kitsu, episode] = id.split(":");
  return { kitsu: Number(kitsu), episode: episode ? Number(episode) : undefined };
};

export async function kitsuMeta(type: ContentType, id: string): Promise<Meta> {
  const { kitsu } = kitsuParts(id);
  const zip = await fetchAniZip({ kitsu_id: kitsu });
  const anilistId = zip?.mappings.anilist_id;
  if (!zip || !anilistId) throw new Error("This anime isn't known to ani.zip");
  const anime = await fetchAnime(anilistId);
  const lang = getPrefs().animeTitles;

  const videos: Video[] =
    type === "movie"
      ? []
      : regularEpisodes(zip).map((e) => {
          const n = Number(e.episode);
          return {
            id: `${id}:${n}`,
            title: episodeTitle(e, lang) ?? `Episode ${n}`,
            season: 1,
            episode: n,
            released: e.airDateUtc ?? e.airDate ?? e.airdate,
            thumbnail: e.image,
            overview: e.overview ?? e.summary,
            rating: e.rating,
          };
        });

  return {
    id,
    type,
    name: pickTitle(anime.title, lang),
    poster: anime.coverImage.extraLarge ?? anime.coverImage.large ?? undefined,
    ...animeArt(anime, zip),
    description: cleanDescription(anime.description).join("\n\n") || undefined,
    releaseInfo: String(anime.seasonYear ?? anime.startDate?.year ?? "") || undefined,
    genres: anime.genres,
    runtime: anime.duration ? `${anime.duration} min` : undefined,
    trailerYtId: anime.trailer?.site === "youtube" ? anime.trailer.id : undefined,
    videos,
  };
}
