import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useState } from "react";
import { AnimeCard } from "../components/anime/AnimeCard";
import { PosterCard } from "../components/PosterCard";
import { Shelf } from "../components/title/Shelf";
import type { AnimeCard as Card } from "../lib/anime/anilist";
import { useAnimeResults } from "../lib/anime/search";
import { withoutAnime } from "../lib/anime/merge";
import { useAnimeAliases } from "../lib/anime/links";
import { api } from "../lib/api";
import { BROWSE_GENRES, genreOf } from "../lib/genres";
import { usePrefs } from "../lib/prefs";
import { useSearch } from "../lib/queries";
import { useSearchText } from "../lib/searchQuery";
import { addRecentSearch } from "../lib/recentSearches";
import type { ContentType, MetaPreview } from "../lib/types";
import { EmptyState } from "../components/ui/EmptyState";

/**
 * Results for whatever is typed in the navbar's search field, one row per
 * kind so movies, series and anime all show without scrolling. A search that
 * names a genre ("horror") leads with that genre's titles. Nothing typed yet:
 * genres to start from.
 */
export function Search() {
  const text = useSearchText();
  const [query, setQuery] = useState(text.trim());
  const deferred = useDeferredValue(query);
  const { animeEnabled } = usePrefs();

  // Keystrokes update the field instantly; the network waits for a pause.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text.trim()), 180);
    return () => window.clearTimeout(t);
  }, [text]);

  const { data } = useSearch(deferred);
  const hasQuery = deferred.length > 1;
  const genre = hasQuery ? genreOf(deferred) : undefined;
  const anime = useAnimeResults(animeEnabled && hasQuery ? deferred : "");
  const aliases = useAnimeAliases();

  if (text.trim().length < 2) return <div className="scroll search-page" />;

  // Titles without art are almost always stubs nobody's looking for.
  // An anime shows once, as the anime (AniList), not again as a series or movie.
  const movies = withoutAnime(data?.movies.filter((m) => m.poster), anime.items, aliases);
  const series = withoutAnime(data?.series.filter((m) => m.poster), anime.items, aliases);
  const waiting = !hasQuery || !data;
  const nothing = !waiting && !genre && !movies!.length && !series!.length && !anime.items?.length && !anime.loading;

  return (
    // Opening a result counts as running the search (Recent, in the search field).
    <div className="scroll search-page" onClickCapture={(e) => (e.target as HTMLElement).closest(".card") && addRecentSearch(deferred)}>
      <div className="rows search-rows">
        {genre && BROWSE_GENRES.movie.includes(genre) && <GenreRow type="movie" genre={genre} />}
        {genre && BROWSE_GENRES.series.includes(genre) && <GenreRow type="series" genre={genre} />}
        <ResultRow title={genre ? "Movies Named Like It" : "Movies"} items={waiting ? undefined : movies} />
        <ResultRow title={genre ? "Series Named Like It" : "Series"} items={waiting ? undefined : series} />
        {animeEnabled && <AnimeRow title={anime.title} items={anime.items} loading={anime.loading} />}
      </div>
      {nothing && <EmptyState>Nothing found for “{deferred}”.</EmptyState>}
    </div>
  );
}

function GenreRow({ type, genre }: { type: ContentType; genre: string }) {
  const { data } = useQuery({
    queryKey: ["discover", type, "popular", genre],
    queryFn: () => api.catalog(type, "popular", 0, genre),
    staleTime: 30 * 60_000,
  });
  return <ResultRow title={`Popular ${genre} ${type === "movie" ? "Movies" : "Series"}`} items={data} />;
}

function ResultRow({ title, items }: { title: string; items?: MetaPreview[] }) {
  if (items && !items.length) return null;
  return <Shelf title={title} items={items} card={(item) => <PosterCard key={item.id} item={item} />} />;
}

function AnimeRow({ title, items, loading }: { title: string; items?: Card[]; loading: boolean }) {
  if (!loading && !items?.length) return null;
  return <Shelf title={title} items={items} card={(a) => <AnimeCard key={a.id} item={a} />} />;
}
