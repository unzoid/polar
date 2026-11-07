import { useQueries, useQuery } from "@tanstack/react-query";
import {
  type Anime,
  animeLinks,
  aniZipQuery,
  entryAction,
  type EntryAction,
  knowsNothing,
  LIKED_THIS_FILL,
  likedThis,
  needsEntryLinks,
  relatedRows,
  type RelatedCard,
  useMoreRecommendations,
} from "../../lib/anime";
import { keys } from "../../lib/net";
import { usePrefs } from "../../lib/settings";
import { Row } from "../Row";
import { AnimeCard } from "./AnimeCard";
import type { Franchise } from "./AnimeEpisodes";

/**
 * Watch Order and the rest of the franchise not already in the season tabs
 * (lib/anime/relatedRows.ts), then AniList's recommendations. A Watch Order
 * card for one of the page's tabs switches to it, back at the top of the page.
 * Also in This Franchise's manga, novels and entries Polarity can't play open
 * elsewhere (lib/anime/franchiseEntry.ts), or stay out with Settings → Anime.
 */
export function AnimeRelated({ anime, franchise }: { anime: Anime; franchise?: Franchise }) {
  const { watchOrder, also } = relatedRows(anime, franchise);
  const actions = useEntryActions(also);
  const { animeHideUnplayable } = usePrefs();
  const rest = animeHideUnplayable ? also.filter((c) => actions.get(c.card.id)?.kind === "page") : also;
  const card = (c: RelatedCard) => (
    <AnimeCard
      key={`${c.card.id}/${c.label}`}
      item={c.card}
      label={actions.get(c.card.id)?.kind === "youtube" ? `${c.label} · YouTube` : c.label}
      current={c.current}
      action={actions.get(c.card.id)}
      onOpen={
        franchise && c.tab
          ? (e) => {
              franchise.select(c.card.id);
              e.currentTarget.closest(".detail-scroll")?.scrollTo({ top: 0 });
            }
          : undefined
      }
    />
  );
  const watchOrderRow = watchOrder.length > 0 && <Row title="Watch Order">{watchOrder.map(card)}</Row>;
  const franchiseRow = rest.length > 0 && <Row title="Also in This Franchise">{rest.map(card)}</Row>;
  return (
    <div className="rows anime-related">
      {watchOrderRow && franchiseRow ? (
        <div className="anime-franchise-grid">
          <div className="anime-franchise-col" style={{ "--cards": Math.min(2, watchOrder.length) } as React.CSSProperties}>
            {watchOrderRow}
          </div>
          <div className="anime-franchise-col" style={{ "--cards": Math.min(2, rest.length) } as React.CSSProperties}>
            {franchiseRow}
          </div>
        </div>
      ) : (
        <>
          {watchOrderRow}
          {franchiseRow}
        </>
      )}
      <Recommendations anime={anime} franchise={franchise} />
    </div>
  );
}

/**
 * What each card does (lib/anime/franchiseEntry.ts). Only an anime with a YouTube video waits on ani.zip
 * and the stored links, and opens its page until they answer.
 */
function useEntryActions(cards: RelatedCard[]): Map<number, EntryAction> {
  const { animeReadOn } = usePrefs();
  const asked = cards.filter((c) => needsEntryLinks(c.card));
  const zips = useQueries({ queries: asked.map((c) => aniZipQuery(c.card.id)) });
  const { data: links } = useQuery({ queryKey: keys.animeLinks, queryFn: animeLinks, staleTime: Infinity });
  const zip = new Map(asked.map((c, i) => [c.card.id, zips[i]]));
  return new Map(
    cards.map((c) => {
      const z = zip.get(c.card.id);
      const known = z?.isSuccess && links !== undefined;
      const entry = known ? { unknown: knowsNothing(z.data), linked: links.some((l) => l.anilist === c.card.id) } : undefined;
      return [c.card.id, entryAction(c.card, animeReadOn, entry)];
    }),
  );
}

/**
 * AniList's recommendations without this franchise, one card per franchise (lib/anime/likedThis.ts);
 * the next page is asked for when grouping leaves too few to fill the row.
 */
function Recommendations({ anime, franchise }: { anime: Anime; franchise?: Franchise }) {
  const { animeSeparateEntries: separate } = usePrefs();
  const own = (franchise?.seasons ?? []).map((s) => s.card);
  const first = likedThis(anime, anime.recommendations.nodes, own, separate);
  const { data: more } = useMoreRecommendations(anime.id, first.length < LIKED_THIS_FILL && !!anime.recommendations.hasNextPage);
  const recs = more ? likedThis(anime, [...anime.recommendations.nodes, ...more.nodes], own, separate) : first;
  if (!recs.length) return null;
  return (
    <Row title="If You Liked This">
      {recs.map((m) => (
        <AnimeCard key={m.id} item={m} />
      ))}
    </Row>
  );
}
