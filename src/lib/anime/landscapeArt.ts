import { useQuery } from "@tanstack/react-query";
import { call } from "../platform/bridge";
import { keys } from "../net/queryKeys";
import type { AnimeLink } from "../library/identity";
import type { MetaPreview } from "../types";

const distinct = (urls: (string | null | undefined)[]) => urls.filter((u, i, all): u is string => !!u && all.indexOf(u) === i);

/**
 * The pictures a widescreen anime card tries, in turn (re-test N5): the linked IMDb title's backdrop
 * (made for a wide frame, the title's recognisable art), then AniList's banner, and only last the
 * upright cover, cropped. With seasons as separate shows (`separate`, #194) the entry's own banner and
 * cover come first: the linked title's backdrop is the same for every season, so it's only the last try.
 */
export function landscapeArt({
  imdb,
  bannerImage,
  cover,
  separate = false,
}: {
  imdb: string | null | undefined;
  bannerImage?: string | null;
  cover?: string | null;
  separate?: boolean;
}): string[] {
  const backdrop = imdb?.startsWith("tt") ? `https://images.metahub.space/background/large/${imdb}/img` : null;
  return distinct(separate ? [bannerImage, cover, backdrop] : [backdrop, bannerImage, cover]);
}

/**
 * The pictures an upright anime card tries, in turn (#27): the linked IMDb title's poster, the same for
 * every season of a show, then the entry's own AniList cover. With seasons as separate shows (#194) the
 * entry's own cover first, so each season looks like itself.
 */
export function posterArt({ imdb, cover, separate = false }: { imdb: string | null | undefined; cover?: string | null; separate?: boolean }): string[] {
  const poster = imdb?.startsWith("tt") ? `https://images.metahub.space/poster/medium/${imdb}/img` : null;
  return distinct(separate ? [cover, poster] : [poster, cover]);
}

/**
 * An AniList entry's IMDb id from the anime id lists kept on the device (no request per card);
 * undefined while looking, null when it has none.
 */
export function useListedImdb(anilistId: number) {
  return useQuery({
    queryKey: keys.anime.listedImdb(anilistId),
    queryFn: () =>
      call<{ imdb_id?: string | null } | null>("anime_ids", { key: "anilist_id", value: String(anilistId) })
        .then((m) => m?.imdb_id ?? null)
        .catch(() => null),
    staleTime: Infinity,
    gcTime: 60 * 60_000,
  }).data;
}

/**
 * The IMDb id a card links an AniList entry to (#34): the one its page found when it was opened (a stored
 * link, docs/anime-identity.md), else the id lists' one, so an entry never opened has it too. Undefined
 * until both have answered, so the art doesn't change once drawn; null when neither has one.
 */
export function linkedImdb(anilistId: number, listed: string | null | undefined, links: AnimeLink[] | undefined): string | null | undefined {
  if (listed === undefined || links === undefined) return undefined;
  const stored = links.find((l) => l.anilist === anilistId && l.canonical.startsWith("tt"))?.canonical;
  return stored ?? listed;
}

/**
 * A TV card's preview with the linked art as its picture: on a landscape card {@link landscapeArt} (the
 * linked backdrop, then the preview's own: ani.zip's fanart or the banner, then the cover), on a poster
 * {@link posterArt}; with seasons as separate shows (`separate`) the preview's own first. No picture until the link is known.
 */
export function withLinkedArt(
  preview: MetaPreview,
  imdb: string | null | undefined,
  shape: "landscape" | "poster" = "landscape",
  separate = false,
): { item: MetaPreview; fallbacks: string[] } {
  if (shape === "poster") {
    if (imdb === undefined) return { item: { ...preview, poster: undefined }, fallbacks: [] };
    const [poster, ...fallbacks] = posterArt({ imdb, cover: preview.poster, separate });
    return { item: { ...preview, poster }, fallbacks };
  }
  if (imdb === undefined) return { item: { ...preview, background: undefined }, fallbacks: [] };
  const [background, ...fallbacks] = landscapeArt({ imdb, bannerImage: preview.background, cover: preview.poster, separate });
  return { item: { ...preview, background }, fallbacks };
}
