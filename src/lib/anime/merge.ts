import { canonicalId, dedupeByTitle } from "../library/identity";
import type { MetaPreview } from "../types";
import type { AnimeCard } from "./anilist";

/** A title as search compares it: lower case, letters and digits only. */
export const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Movies and series that are one of these anime, gone: the same show shouldn't
 * come up twice, and its anime page (AniList's episodes, art, airing) is the
 * one to open (docs/anime-identity.md).
 *
 * An anime the user has opened has a link: a result is that anime when its
 * canonical id is the one the anime plays from, whatever either is called.
 * For one without a link, the old guess: the same title in any of AniList's
 * languages and a year that agrees. Results that are one show under two ids
 * (a Kitsu addon's `kitsu:N` and Cinemeta's `tt…`) show once, the first.
 */
export function withoutAnime(items: MetaPreview[] | undefined, anime: AnimeCard[] | undefined, aliases: ReadonlyMap<string, string> = new Map()) {
  if (!items) return items;
  const claimed = new Set<string>();
  const byTitle = new Map<string, (number | undefined)[]>();
  for (const a of anime ?? []) {
    const own = `anilist:${a.id}`;
    const canonical = canonicalId(own, aliases);
    if (canonical !== own) {
      claimed.add(canonical);
      continue;
    }
    const year = a.seasonYear ?? a.startDate?.year ?? undefined;
    for (const t of [a.title.english, a.title.romaji, a.title.native]) {
      const k = norm(t);
      if (k) byTitle.set(k, [...(byTitle.get(k) ?? []), year]);
    }
  }
  const kept = items.filter((m) => {
    if (claimed.has(canonicalId(m.id, aliases))) return false;
    const years = byTitle.get(norm(m.name));
    if (!years) return true;
    const year = Number(m.releaseInfo?.match(/\d{4}/)?.[0]);
    // No year on either side: the title alone decides.
    return !years.some((y) => !y || !year || Math.abs(y - year) <= 1);
  });
  return dedupeByTitle(kept, (m) => m.id, aliases);
}
