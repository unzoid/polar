import { type Anime, LIKED_THIS_FILL, likedThis, relatedRows, type RelatedCard, useMoreRecommendations } from "../../lib/anime";
import { usePrefs } from "../../lib/settings";
import { Row } from "../Row";
import { AnimeCard } from "./AnimeCard";
import type { Franchise } from "./AnimeEpisodes";

/**
 * Watch Order and the rest of the franchise not already in the season tabs
 * (lib/anime/relatedRows.ts), then AniList's recommendations. A Watch Order
 * card for one of the page's tabs switches to it, back at the top of the page.
 */
export function AnimeRelated({ anime, franchise }: { anime: Anime; franchise?: Franchise }) {
  const { watchOrder, also: rest } = relatedRows(anime, franchise);
  const card = (c: RelatedCard) => (
    <AnimeCard
      key={`${c.card.id}/${c.label}`}
      item={c.card}
      label={c.label}
      current={c.current}
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
