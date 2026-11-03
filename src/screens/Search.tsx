import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useState } from "react";
import { AnimeCard } from "../components/anime/AnimeCard";
import { PosterCard, PosterSkeleton } from "../components/PosterCard";
import { Row } from "../components/Row";
import { ANIME_GENRES, ANIME_TAGS, useAnimeBrowse, type AnimeCard as Card } from "../lib/anime/anilist";
import { api } from "../lib/api";
import { BROWSE_GENRES, genreOf } from "../lib/genres";
import { usePrefs } from "../lib/prefs";
import { useSearch } from "../lib/queries";
import { useSearchText } from "../lib/searchQuery";
import type { ContentType, MetaPreview } from "../lib/types";

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

  if (text.trim().length < 2) return <div className="scroll search-page" />;

  // Titles without art are almost always stubs nobody's looking for.
  const movies = data?.movies.filter((m) => m.poster);
  const series = data?.series.filter((m) => m.poster);
  const waiting = !hasQuery || !data;
  const nothing = !waiting && !genre && !movies!.length && !series!.length && !anime.items?.length && !anime.loading;

  return (
    <div className="scroll search-page">
      <div className="rows search-rows">
        {genre && BROWSE_GENRES.movie.includes(genre) && <GenreRow type="movie" genre={genre} />}
        {genre && BROWSE_GENRES.series.includes(genre) && <GenreRow type="series" genre={genre} />}
        <ResultRow title={genre ? "Movies Named Like It" : "Movies"} items={waiting ? undefined : movies} />
        <ResultRow title={genre ? "Series Named Like It" : "Series"} items={waiting ? undefined : series} />
        {animeEnabled && <AnimeRow title={anime.title} items={anime.items} loading={anime.loading} />}
      </div>
      {nothing && <p className="empty t-body muted">Nothing found for “{deferred}”.</p>}
    </div>
  );
}

/** AniList's answer: a genre or kind of show if the search names one, otherwise a title search. */
function useAnimeResults(query: string) {
  const lower = query.toLowerCase();
  const genre = ANIME_GENRES.find((g) => g.toLowerCase() === lower);
  const tag = genre ? undefined : ANIME_TAGS.find((t) => t.toLowerCase() === lower);
  const q = useAnimeBrowse(
    { search: genre || tag ? "" : query, genre: genre ?? "", tag: tag ?? "", season: "", year: 0, format: "", status: "", sort: "POPULARITY_DESC" },
    !!query,
  );
  return {
    title: genre || tag ? `${genre ?? tag} Anime` : "Anime",
    items: q.data?.pages[0]?.media,
    loading: !!query && q.isLoading,
  };
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
  return (
    <Row title={title}>
      {items ? items.map((item) => <PosterCard key={item.id} item={item} />) : Array.from({ length: 8 }, (_, i) => <PosterSkeleton key={i} />)}
    </Row>
  );
}

function AnimeRow({ title, items, loading }: { title: string; items?: Card[]; loading: boolean }) {
  if (!loading && !items?.length) return null;
  return (
    <Row title={title}>
      {items ? items.map((a) => <AnimeCard key={a.id} item={a} />) : Array.from({ length: 8 }, (_, i) => <PosterSkeleton key={i} />)}
    </Row>
  );
}
