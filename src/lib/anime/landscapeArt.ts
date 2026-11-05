import { useQuery } from "@tanstack/react-query";
import { call } from "../platform/bridge";
import { keys } from "../net/queryKeys";

/**
 * The pictures a widescreen anime card tries, in turn (re-test N5): the linked IMDb title's backdrop
 * (made for a wide frame, the title's recognisable art), then AniList's banner, and only last the
 * upright cover, cropped.
 */
export function landscapeArt({ imdb, bannerImage, cover }: { imdb: string | null | undefined; bannerImage?: string | null; cover?: string | null }): string[] {
  const backdrop = imdb?.startsWith("tt") ? `https://images.metahub.space/background/large/${imdb}/img` : null;
  return [backdrop, bannerImage, cover].filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
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
