/**
 * What an anime page's Watch Order and Also in This Franchise rows hold (#193). Pure, so tests can
 * check with made-up franchises that no card leads back to the page it's on.
 *
 * On a franchise page (its seasons as tabs), Watch Order is the whole prequel/sequel chain, the
 * page's own tabs marked so their cards switch tabs; Also in This Franchise is what the page doesn't
 * hold. With Settings → Anime → Seasons as separate shows (#22), or a show with one entry, both
 * rows come from the entry's own relations, as before.
 */
import type { Anime, AnimeCard, RelationType } from "./anilist";
import { FORMAT_LABEL, RELATION_LABEL } from "./format";
import type { AnimeSeason } from "./seasons";

/** Watch order first (prequels, sequels, the main story), then everything else. */
const RELATION_ORDER: RelationType[] = [
  "PREQUEL",
  "SEQUEL",
  "PARENT",
  "SIDE_STORY",
  "SPIN_OFF",
  "ALTERNATIVE",
  "SUMMARY",
  "COMPILATION",
  "CONTAINS",
  "CHARACTER",
  "OTHER",
  "SOURCE",
  "ADAPTATION",
];

const WATCH_ORDER: RelationType[] = ["PREQUEL", "SEQUEL", "PARENT"];

export interface RelatedCard {
  card: AnimeCard;
  label: string;
  /** One of this page's season tabs: its card switches to the tab instead of opening a page. */
  tab?: boolean;
  /** The tab on screen now. */
  current?: boolean;
}

export interface RelatedRows {
  watchOrder: RelatedCard[];
  also: RelatedCard[];
}

/** This page's tabs, the one on screen, the chain they came from and whether it's still being walked. */
export interface FranchiseTabs {
  seasons: AnimeSeason[];
  active: number;
  order?: AnimeCard[];
  loading?: boolean;
}

const year = (c: AnimeCard) => c.seasonYear ?? c.startDate?.year;
const facts = (...parts: (string | number | null | undefined)[]) => parts.filter(Boolean).join(" · ");

export function relatedRows(anime: Anime, franchise?: FranchiseTabs): RelatedRows {
  const edges = anime.relations.edges
    .filter((e) => e.node.id !== anime.id)
    .sort(
      (a, b) =>
        RELATION_ORDER.indexOf(a.relationType) - RELATION_ORDER.indexOf(b.relationType) || (a.node.startDate?.year ?? 9999) - (b.node.startDate?.year ?? 9999),
    );
  const edgeCard = (e: (typeof edges)[number]): RelatedCard => ({
    card: e.node,
    label: facts(RELATION_LABEL[e.relationType], e.node.format && FORMAT_LABEL[e.node.format], year(e.node)),
  });

  if (!franchise) {
    const watchOrder = edges.filter((e) => WATCH_ORDER.includes(e.relationType));
    return { watchOrder: watchOrder.map(edgeCard), also: edges.filter((e) => !watchOrder.includes(e)).map(edgeCard) };
  }

  const tabs = new Map(franchise.seasons.map((s) => [s.card.id, s.label]));
  // While the chain is still being walked, the order isn't known and a prequel or sequel may yet become a tab.
  const order = franchise.loading ? [] : (franchise.order ?? franchise.seasons.map((s) => s.card));
  const watchOrder: RelatedCard[] = order
    .filter((c) => c.type !== "MANGA")
    .map((c) => {
      const tab = tabs.get(c.id);
      if (tab === undefined) return { card: c, label: facts(c.format && FORMAT_LABEL[c.format], year(c)) };
      const current = c.id === franchise.active;
      return { card: c, label: current ? facts(tab, "Now showing") : tab, tab: true, current };
    });
  const inOrder = new Set(order.map((c) => c.id));
  const also = edges
    .filter((e) => !tabs.has(e.node.id) && !inOrder.has(e.node.id))
    .filter((e) => !(franchise.loading && (e.relationType === "PREQUEL" || e.relationType === "SEQUEL") && e.node.type !== "MANGA"))
    .map(edgeCard);
  // An order of this page's tabs alone repeats the tabs: no row.
  return { watchOrder: watchOrder.some((c) => !c.tab) ? watchOrder : [], also };
}
