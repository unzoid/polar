import type { MetaPreview } from "../types";
import type { AnimeCard } from "./anilist";
import { anizipImage, type AniZip } from "./anizip";
import { cleanDescription, pickTitle } from "./format";

const ID_PREFIX = "anilist:";

/** True for a preview made here: it has no IMDb page behind it to fetch. */
export const isAnimePreview = (id: string) => id.startsWith(ID_PREFIX);

/**
 * An anime in the shape the home carousel and TV stage draw. Widescreen art
 * and the logo come from ani.zip when it's known; AniList's banner stands in.
 * No `imdbRating`: an AniList score isn't one.
 */
export function animePreview(a: AnimeCard, zip: AniZip | null | undefined, titles: "romaji" | "english" | "native"): MetaPreview {
  return {
    id: `${ID_PREFIX}${a.id}`,
    type: a.format === "MOVIE" ? "movie" : "series",
    name: pickTitle(a.title, titles),
    poster: a.coverImage.extraLarge ?? a.coverImage.large ?? undefined,
    background: anizipImage(zip, "Fanart") ?? a.bannerImage ?? a.coverImage.extraLarge ?? undefined,
    logo: anizipImage(zip, "Clearlogo"),
    description: cleanDescription(a.description)[0],
    releaseInfo: String(a.seasonYear ?? a.startDate?.year ?? "") || undefined,
    genres: a.genres,
  };
}
