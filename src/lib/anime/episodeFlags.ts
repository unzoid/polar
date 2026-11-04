import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

/**
 * Which episodes are filler and which are recaps, what AniList doesn't track.
 * The app asks Jikan (MyAnimeList) and, failing that, animefillerlist.com,
 * and keeps the answer on disk for a day (crates/anime/src/fillers.rs).
 * Strictly a bonus: when both are down, episodes just show without badges.
 */
export interface EpisodeFlags {
  filler: boolean;
  recap: boolean;
}

/** What the `anime_episode_flags` command answers. */
interface FlagLists {
  filler: number[];
  recap: number[];
  source?: "jikan" | "animefillerlist";
}

/** "Kazeori: Arashi-hen" → "kazeori-arashi-hen", animefillerlist.com's show slugs. */
export const slug = (t: string) =>
  t
    .replace(/\p{M}/gu, "")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Episode number → its flags, for the episodes that have any. */
export function flagMap({ filler, recap }: FlagLists): Map<number, EpisodeFlags> {
  const out = new Map<number, EpisodeFlags>();
  const at = (n: number) => out.get(n) ?? out.set(n, { filler: false, recap: false }).get(n)!;
  for (const n of filler) at(n).filler = true;
  for (const n of recap) at(n).recap = true;
  return out;
}

async function fetchFlags(malId: number, titles: string[]): Promise<Map<number, EpisodeFlags>> {
  const slugs = [...new Set(titles.map(slug).filter(Boolean))];
  const lists = await invoke<FlagLists>("anime_episode_flags", {
    malId,
    slugs,
  }).catch(() => ({ filler: [], recap: [] }));
  return flagMap(lists);
}

export function useEpisodeFlags(malId: number | null | undefined, titles: (string | null | undefined)[] = [], enabled = true) {
  const names = titles.filter((t): t is string => !!t);
  return useQuery({
    queryKey: ["anime", "episodeFlags", malId],
    queryFn: () => fetchFlags(malId!, names),
    enabled: !!malId && enabled,
    // The app's disk cache decides freshness; this only spares repeat calls within a visit.
    staleTime: 60 * 60_000,
    retry: false,
  });
}
