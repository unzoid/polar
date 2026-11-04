import { useRef, useState } from "react";
import { AnimeCharacters } from "../components/anime/AnimeCharacters";
import { AnimeDetails } from "../components/anime/AnimeDetails";
import { AnimeEpisodes, SeasonTabs, type Franchise } from "../components/anime/AnimeEpisodes";
import { AnimeHero } from "../components/anime/AnimeHero";
import { AnimeRelated } from "../components/anime/AnimeRelated";
import { Img } from "../components/Img";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import { type Anime, animeArt, type AnimeCard as Card, useAnime, useAnimeSeasons, useAnimeTitle, useAniZip } from "../lib/anime";
import { useFoldSnap } from "../lib/ui";
import type { EpisodeLayout } from "../lib/types";

/**
 * An anime's page, built from AniList with ani.zip filling in episode titles,
 * stills and the link to the app's sources. Its episodes play through the
 * same IMDb-keyed streams, player and watch history as everything else, so
 * Continue Watching and Up Next just work.
 *
 * One page per franchise: AniList splits a show into an entry per season (or
 * cour), and the page opens at one of them with the rest as season tabs.
 * Switching swaps the hero, episodes and details in place, keeping the
 * scroll position and Back, like a show's seasons.
 */
export function AnimeDetail({ id, preview }: { id: number; preview?: Card }) {
  const [activeId, setActiveId] = useState(id);
  const { data: opened } = useAnime(id);
  const { data: chain } = useAnimeSeasons(opened);
  const seasons = chain && chain.length > 1 && chain.some((s) => s.card.id === id) ? chain : undefined;
  // While a season loads, the last one stays on screen (dimmed) so the page keeps its height and place.
  const { data: loaded, isError } = useAnime(activeId, { keepPrevious: true });
  const anime = loaded?.id === activeId ? loaded : undefined;
  const shown: Card | undefined = anime ?? seasons?.find((s) => s.card.id === activeId)?.card ?? (activeId === id ? preview : loaded);
  const { data: zip } = useAniZip(activeId);
  const title = useAnimeTitle();

  const scroller = useRef<HTMLDivElement>(null);
  useFoldSnap(scroller, !!shown);

  if (isError && !shown) return <EmptyState>Couldn't load this anime from AniList. Try again in a minute.</EmptyState>;
  if (!shown) return <Skeleton className="detail-loading" />;

  const { background: art, logo } = animeArt(shown, zip);
  const franchise = seasons && { seasons, active: activeId, select: setActiveId };

  return (
    <div className="detail anime-detail" style={{ "--cover": shown.coverImage.color ?? undefined } as React.CSSProperties}>
      <div className="detail-bg" aria-hidden>
        <Img src={art} alt="" loading="eager" className="detail-bg-sharp" />
        <Img src={art} alt="" loading="eager" className="detail-bg-blur" />
        <div className="detail-bg-scrim" />
      </div>
      <div className="scroll detail-scroll" ref={scroller}>
        <AnimeHero item={shown} anime={anime} logo={logo} name={title(shown.title)} />
        {loaded && <Body anime={loaded} franchise={franchise} switching={!anime} />}
      </div>
    </div>
  );
}

// --- Below the fold ---------------------------------------------------------

/**
 * Everything below the hero on one page, as a show's own: the episodes in a
 * shelf (or a list, your choice), then the cast, details and franchise links.
 */
function Body({ anime, franchise, switching }: { anime: Anime; franchise?: Franchise; switching: boolean }) {
  const isMovie = anime.format === "MOVIE";
  const hasRelated = anime.relations.edges.length > 0 || anime.recommendations.nodes.some((n) => !!n.mediaRecommendation);
  // This page's choice, kept across seasons; until you pick one, the default from Settings → Browsing.
  const [layout, setLayout] = useState<EpisodeLayout | undefined>();
  return (
    <div className="anime-body" data-switching={switching || undefined}>
      {!isMovie && <AnimeEpisodes key={anime.id} anime={anime} franchise={franchise} layoutChoice={layout} onLayout={setLayout} />}
      {/* A film in a franchise: the season tabs alone, to get back to the series. */}
      {isMovie && franchise && (
        <section className="seasons">
          <SeasonTabs franchise={franchise} />
        </section>
      )}
      {anime.characters.edges.length > 0 && <AnimeCharacters anime={anime} />}
      <h2 className="t-title2 anime-section-title">Details</h2>
      <AnimeDetails anime={anime} />
      {hasRelated && <AnimeRelated anime={anime} franchise={franchise} />}
    </div>
  );
}
