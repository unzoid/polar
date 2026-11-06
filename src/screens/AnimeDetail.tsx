import { useCallback, useRef, useState } from "react";
import { useBackdropTrailer, usePageOnTop } from "../components/BackdropTrailer";
import { useTrailerOpen } from "../components/Trailer";
import { AnimeCharacters } from "../components/anime/AnimeCharacters";
import { AnimeDetails } from "../components/anime/AnimeDetails";
import { AnimeEpisodes, SeasonTabs, type Franchise } from "../components/anime/AnimeEpisodes";
import { AnimeHero } from "../components/anime/AnimeHero";
import { AnimeRelated } from "../components/anime/AnimeRelated";
import { Img } from "../components/Img";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import {
  type Anime,
  animeArt,
  type AnimeCard as Card,
  franchiseArt,
  isSeason,
  useAnime,
  useAnimeSeasons,
  useAnimeTitle,
  useAniZip,
  useLinkedImdb,
} from "../lib/anime";
import { useMeta } from "../lib/net";
import { usePrefs } from "../lib/settings";
import { useFoldSnap, useFormFactor } from "../lib/ui";
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
 *
 * With Settings → Anime → Seasons as separate shows (#22), the page is the
 * entry's alone: its episodes, no season tabs, and its prequel and sequel
 * among the related titles.
 */
export function AnimeDetail({ id, preview }: { id: number; preview?: Card }) {
  const { animeSeparateEntries: separate } = usePrefs();
  const [activeId, setActiveId] = useState(id);
  const { data: opened } = useAnime(id);
  const { data: walk, isPending: walking } = useAnimeSeasons(separate ? undefined : opened);
  const chain = walk?.seasons;
  const found = !separate && chain && chain.length > 1 && chain.some((s) => s.card.id === id) ? chain : undefined;
  // Other seasons may be on the way (a long walk while AniList is busy): say so, with this entry as the one tab meanwhile.
  const linked = !!opened?.relations.edges.some((e) => (e.relationType === "PREQUEL" || e.relationType === "SEQUEL") && e.node.type !== "MANGA");
  const seasonsLoading = !separate && linked && (walking || walk?.complete === false);
  const title = useAnimeTitle();
  const seasons = found ?? (seasonsLoading && opened ? [{ card: opened, label: title(opened.title) }] : undefined);
  // While a season loads, the last one stays on screen (dimmed) so the page keeps its height and place.
  const { data: loaded, isError } = useAnime(activeId, { keepPrevious: true });
  const anime = loaded?.id === activeId ? loaded : undefined;
  const shown: Card | undefined = anime ?? seasons?.find((s) => s.card.id === activeId)?.card ?? (activeId === id ? preview : loaded);

  const scroller = useRef<HTMLDivElement>(null);
  useFoldSnap(scroller, !!shown);
  // A phone's page scrolls as one, the art at its top (Detail.tsx).
  const phone = useFormFactor().form === "phone";

  // The IMDb trailer behind the page, as a show's page has (test report 1, item 17): one IMDb id
  // covers the whole franchise and its trailer is the first season's, so only on the first entry.
  const root = useRef<HTMLDivElement>(null);
  const onTop = usePageOnTop(root);
  const [imdb, setImdb] = useState<string | null>();
  const [scrolledAway, setScrolledAway] = useState(false);
  const bigTrailer = !!useTrailerOpen();
  // An entry on its own (separate shows) is the first when no season comes before it.
  const firstKnown = separate ? !!opened : !seasonsLoading;
  const firstEntry = separate
    ? !!opened && !opened.relations.edges.some((e) => e.relationType === "PREQUEL" && e.node.type !== "MANGA" && isSeason(e.node))
    : firstKnown && (!found || found[0].card.id === activeId);
  const trailer = useBackdropTrailer(firstEntry && imdb?.startsWith("tt") ? imdb : undefined, { active: onTop, paused: scrolledAway || bigTrailer });
  const onImdb = useCallback((id: string | null | undefined) => setImdb(id), []);

  // One background and logo for every season tab (#27): the first entry's linked title's, else its ani.zip art.
  // A later entry on its own page (separate shows) has its own ani.zip art.
  const first = found?.[0].card ?? shown;
  const { data: firstZip } = useAniZip(first?.id ?? 0, !!first);
  const firstLinked = useLinkedImdb(first?.id ?? 0);
  const anyMovie = first?.format === "MOVIE" || shown?.format === "MOVIE";
  // A later entry whose first one has no known link: the title this one plays from, unless a movie is involved (its own title).
  const resolved = !firstKnown ? undefined : firstEntry ? imdb : separate ? null : (firstLinked ?? (anyMovie ? null : imdb));
  // Kept once found, so switching tabs (each finds its own id again) never blanks the art.
  const kept = useRef<{ first: number; imdb: string | null }>(undefined);
  if (first && resolved !== undefined && kept.current?.first !== first.id) kept.current = { first: first.id, imdb: resolved };
  const franchiseImdb = first && kept.current?.first === first.id ? kept.current.imdb : resolved;
  const { data: meta, isLoading: metaLoading } = useMeta(
    first?.format === "MOVIE" ? "movie" : "series",
    franchiseImdb ?? "",
    !!franchiseImdb?.startsWith("tt"),
  );

  if (isError && !shown) return <EmptyState>Couldn't load this anime from AniList. Try again in a minute.</EmptyState>;
  if (!shown) return <Skeleton className="detail-loading" />;

  const art = franchiseArt({ imdb: franchiseImdb, meta, metaLoading, first: animeArt(first ?? shown, firstZip) });
  const franchise = seasons && { seasons, active: activeId, select: setActiveId, loading: seasonsLoading, order: found && walk?.order };
  const backdrop = (
    <div className="detail-bg" aria-hidden>
      <Img src={art.background} alt="" loading="eager" className="detail-bg-sharp" />
      {trailer.node}
      <Img src={art.background} alt="" loading="eager" className="detail-bg-blur" />
      <div className="detail-bg-scrim" />
    </div>
  );

  return (
    <div
      className="detail anime-detail"
      ref={root}
      data-trailer={trailer.visible}
      style={{ "--cover": shown.coverImage.color ?? undefined } as React.CSSProperties}
    >
      {!phone && backdrop}
      <div
        className="scroll detail-scroll"
        ref={scroller}
        onScroll={(e) => setScrolledAway(e.currentTarget.scrollTop > e.currentTarget.clientHeight * 0.25)}
      >
        {phone && backdrop}
        <AnimeHero item={shown} anime={anime} logo={art.logo} backdrop={art.background} name={title(shown.title)} onImdb={onImdb} trailer={trailer} />
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
