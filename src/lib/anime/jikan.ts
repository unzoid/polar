import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

/**
 * Jikan (api.jikan.moe, an unofficial MyAnimeList API) for what AniList
 * doesn't track: which episodes are filler and which are recaps. Jikan allows
 * 3 requests a second, so long shows' pages are fetched one after another.
 * Strictly a bonus: when it's down, episodes just show without the badges.
 */
export interface EpisodeFlags {
  filler: boolean;
  recap: boolean;
}

interface JikanPage {
  pagination: { has_next_page: boolean };
  data: { mal_id: number; filler: boolean; recap: boolean }[];
}

async function fetchJikan(malId: number): Promise<Map<number, EpisodeFlags>> {
  const out = new Map<number, EpisodeFlags>();
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`, { signal: AbortSignal.timeout(page === 1 ? 6_000 : 12_000) });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500));
      page--;
      continue;
    }
    if (!res.ok) break;
    const json = (await res.json()) as JikanPage;
    for (const e of json.data) if (e.filler || e.recap) out.set(e.mal_id, { filler: e.filler, recap: e.recap });
    if (!json.pagination.has_next_page) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  return out;
}

/** "Kazeori: Arashi-hen" → "kazeori-arashi-hen", animefillerlist.com's show slugs. */
const slug = (t: string) =>
  t
    .replace(/\p{M}/gu, "")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Jikan first (it also knows recaps); when it's unreachable or knows nothing,
 * animefillerlist.com's list by the show's names (filler only).
 */
async function fetchFlags(malId: number, titles: string[]): Promise<Map<number, EpisodeFlags>> {
  const jikan = await fetchJikan(malId).catch(() => new Map<number, EpisodeFlags>());
  if (jikan.size || !titles.length) return jikan;
  const slugs = [...new Set(titles.map(slug).filter(Boolean))];
  const filler = await invoke<number[]>("anime_filler", { slugs }).catch(() => []);
  return new Map(filler.map((n) => [n, { filler: true, recap: false }]));
}

export function useEpisodeFlags(malId: number | null | undefined, titles: (string | null | undefined)[] = [], enabled = true) {
  const names = titles.filter((t): t is string => !!t);
  return useQuery({
    queryKey: ["jikan", "flags", malId],
    queryFn: () => fetchFlags(malId!, names),
    enabled: !!malId && enabled,
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: false,
  });
}
