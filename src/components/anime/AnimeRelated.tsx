import type { Anime, AnimeCard as Card, RelationType } from "../../lib/anime/anilist";
import { FORMAT_LABEL, RELATION_LABEL } from "../../lib/anime/format";
import { Row } from "../Row";
import { AnimeCard } from "./AnimeCard";
import type { Franchise } from "./AnimeEpisodes";

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

/**
 * The rest of the franchise not already in the season tabs, watch order first,
 * then AniList's recommendations.
 */
export function AnimeRelated({ anime, franchise }: { anime: Anime; franchise?: Franchise }) {
  // Entries already in the season tabs above aren't repeated here.
  const tabbed = new Set((franchise?.seasons ?? []).map((s) => s.card.id));
  const edges = [...anime.relations.edges]
    .filter((e) => !tabbed.has(e.node.id))
    .sort(
      (a, b) =>
        RELATION_ORDER.indexOf(a.relationType) - RELATION_ORDER.indexOf(b.relationType) || (a.node.startDate?.year ?? 9999) - (b.node.startDate?.year ?? 9999),
    );
  const watchOrder = edges.filter((e) => ["PREQUEL", "SEQUEL", "PARENT"].includes(e.relationType));
  const rest = edges.filter((e) => !watchOrder.includes(e));
  const label = (e: (typeof edges)[number]) =>
    [RELATION_LABEL[e.relationType], e.node.format ? FORMAT_LABEL[e.node.format] : undefined, e.node.seasonYear ?? e.node.startDate?.year]
      .filter(Boolean)
      .join(" · ");
  const watchOrderRow = watchOrder.length > 0 && (
    <Row title="Watch Order">
      {watchOrder.map((e) => (
        <AnimeCard key={`${e.relationType}/${e.node.id}`} item={e.node} label={label(e)} />
      ))}
    </Row>
  );
  const franchiseRow = rest.length > 0 && (
    <Row title="Also in This Franchise">
      {rest.map((e) => (
        <AnimeCard key={`${e.relationType}/${e.node.id}`} item={e.node} label={label(e)} />
      ))}
    </Row>
  );
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
      <Recommendations anime={anime} />
    </div>
  );
}

function Recommendations({ anime }: { anime: Anime }) {
  const recs = anime.recommendations.nodes.map((n) => n.mediaRecommendation).filter((m): m is Card => !!m);
  if (!recs.length) return null;
  return (
    <Row title="If You Liked This">
      {recs.map((m) => (
        <AnimeCard key={m.id} item={m} />
      ))}
    </Row>
  );
}
