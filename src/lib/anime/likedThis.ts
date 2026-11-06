/**
 * The anime page's "If You Liked This" row (#191): AniList's recommendations without the page's own
 * franchise (that's what Watch Order and Also in This Franchise are for), one card per franchise with
 * its entries' ratings added up. Pure; type-only imports.
 */
import type { Anime, AnimeCard } from "./anilist";
import { franchiseGroups, nameKeys } from "./franchise";

/** Cards the row should have; fewer after grouping, and the next page of recommendations is asked for. */
export const LIKED_THIS_FILL = 12;

type Recommendation = Anime["recommendations"]["nodes"][number];

/**
 * The row's cards, best first. Left out: the entry itself, every entry it's related to, the page's
 * season tabs (`own`), and whatever is one franchise with any of them (prequel/sequel links, or a title
 * naming the same franchise as the entry's or a tab's). With seasons as separate shows (#22) each
 * recommended entry keeps its own card, as in every other list; otherwise each franchise is one card,
 * its most recommended entry, ranked by its entries' ratings together.
 */
export function likedThis(anime: Anime, recs: Recommendation[], own: AnimeCard[], separate: boolean): AnimeCard[] {
  const ownCards = [anime, ...own];
  const ownIds = new Set([...ownCards.map((c) => c.id), ...anime.relations.edges.map((e) => e.node.id)]);
  const ownNames = new Set(ownCards.flatMap(nameKeys));
  const rating = new Map<number, number>();
  const cards: AnimeCard[] = [];
  for (const r of recs) {
    const card = r.mediaRecommendation;
    if (!card || rating.has(card.id)) continue;
    rating.set(card.id, r.rating);
    cards.push(card);
  }
  const ownFranchise = (group: AnimeCard[]) =>
    group.some((c) => ownIds.has(c.id) || (c.chain ?? []).some((id) => ownIds.has(id)) || nameKeys(c).some((k) => ownNames.has(k)));
  const groups = franchiseGroups(cards).filter((g) => !ownFranchise(g));
  if (separate) return cards.filter((c) => groups.some((g) => g.includes(c)));
  const score = (g: AnimeCard[]) => g.reduce((sum, c) => sum + Math.max(0, rating.get(c.id) ?? 0), 0);
  return groups
    .map((g) => ({ card: g.reduce((best, c) => ((rating.get(c.id) ?? 0) > (rating.get(best.id) ?? 0) ? c : best)), score: score(g) }))
    .sort((a, b) => b.score - a.score)
    .map((g) => g.card);
}
