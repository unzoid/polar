import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useState } from "react";
import { AnimeCard } from "../components/anime/AnimeCard";
import { PosterCard } from "../components/PosterCard";
import { Shelf } from "../components/title/Shelf";
import { type AnimeCard as Card, retryTitle, useAnimeAliases, useAnimeResults, withoutAnime } from "../lib/anime";
import { api } from "../lib/api";
import { addRecentSearch, BROWSE_GENRES, catalogKey, catalogTitle, genreOf, searchMinLength, useAddonSearches, useSearchText } from "../lib/catalog";
import { usePrefs } from "../lib/settings";
import { useRouter } from "../lib/router";
import { keys, useSearch } from "../lib/net";
import type { ContentType, MetaPreview } from "../lib/types";
import { EmptyState } from "../components/ui/EmptyState";

/**
 * Results for whatever is typed in the navbar's search field, one row per
 * kind so movies, series and anime all show without scrolling. A search that
 * names a genre ("horror") leads with that genre's titles. Add-ons whose
 * catalogs take a search follow, a row each (#206). Nothing typed yet:
 * genres to start from.
 */
export function Search() {
  const text = useSearchText();
  const [query, setQuery] = useState(text.trim());
  const deferred = useDeferredValue(query);
  const { animeEnabled } = usePrefs();
  const searchTab = useRouter().stack.length === 1;

  // Keystrokes update the field instantly; the network waits for a pause.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text.trim()), 180);
    return () => window.clearTimeout(t);
  }, [text]);

  const { data } = useSearch(deferred);
  const hasQuery = deferred.length >= searchMinLength(deferred);
  const genre = hasQuery ? genreOf(deferred) : undefined;
  // What the catalogs found (they forgive typos): what AniList is asked for when the typed words find nothing.
  const anime = useAnimeResults(animeEnabled && hasQuery ? deferred : "", retryTitle(data?.series ?? [], data?.movies ?? []));
  const aliases = useAnimeAliases();
  const fromAddons = useAddonSearches(hasQuery ? deferred : "");

  // Opened by iOS's search tab (the stack's root) with nothing typed yet: say what the field above is for.
  if (!text.trim())
    return <div className="scroll search-page">{searchTab && <EmptyState>{animeEnabled ? "Search for movies, series and anime." : "Search for movies and series."}</EmptyState>}</div>;
  // One Latin letter matches half the catalog: ask for another rather than show an empty page.
  if (text.trim().length < searchMinLength(text.trim()))
    return (
      <div className="scroll search-page">
        <EmptyState>Type another letter to search.</EmptyState>
      </div>
    );

  // Titles without art are almost always stubs nobody's looking for.
  // An anime shows once, as the anime (AniList), not again as a series or movie.
  // Against every entry found, not one per franchise: a later part Cinemeta lists as its own show goes too.
  const movies = withoutAnime(data?.movies.filter((m) => m.poster), anime.all, aliases);
  const series = withoutAnime(data?.series.filter((m) => m.poster), anime.all, aliases);
  const waiting = !hasQuery || !data;
  const addonsBusy = fromAddons.some((r) => !r.items && !r.failed);
  const addonsFound = fromAddons.some((r) => r.items?.length);
  const nothing = !waiting && !genre && !movies!.length && !series!.length && !anime.items?.length && !anime.loading && !addonsBusy && !addonsFound;

  return (
    // Opening a result counts as running the search (Recent, in the search field).
    <div className="scroll search-page" onClickCapture={(e) => (e.target as HTMLElement).closest(".card") && addRecentSearch(deferred)}>
      <div className="rows search-rows">
        {genre && BROWSE_GENRES.movie.includes(genre) && <GenreRow type="movie" genre={genre} />}
        {genre && BROWSE_GENRES.series.includes(genre) && <GenreRow type="series" genre={genre} />}
        <ResultRow title={genre ? "Movies Named Like It" : "Movies"} items={waiting ? undefined : movies} />
        <ResultRow title={genre ? "Series Named Like It" : "Series"} items={waiting ? undefined : series} />
        {animeEnabled && <AnimeRow title={anime.title} items={anime.items} loading={anime.loading} failed={anime.failed} retry={anime.retry} />}
        {/* A failing add-on leaves its row out; Polarity's results above never wait for one. */}
        {fromAddons.map((r) => !r.failed && <ResultRow key={catalogKey(r.catalog)} title={catalogTitle(r.catalog)} items={r.items} />)}
      </div>
      {nothing && <EmptyState>Nothing found for “{deferred}”.</EmptyState>}
    </div>
  );
}

function GenreRow({ type, genre }: { type: ContentType; genre: string }) {
  const { data } = useQuery({
    queryKey: keys.genreRow(type, genre),
    queryFn: () => api.catalog(type, "popular", 0, genre),
    staleTime: 30 * 60_000,
  });
  return <ResultRow title={`Popular ${genre} ${type === "movie" ? "Movies" : "Series"}`} items={data} />;
}

function ResultRow({ title, items }: { title: string; items?: MetaPreview[] }) {
  if (items && !items.length) return null;
  return <Shelf title={title} items={items} card={(item) => <PosterCard key={item.id} item={item} />} />;
}

function AnimeRow({ title, items, loading, failed, retry }: { title: string; items?: Card[]; loading: boolean; failed: boolean; retry: () => void }) {
  // A failed search isn't "no anime": it says so, with a way to try again (test report 1, item 28).
  if (failed && !items?.length)
    return (
      <section className="row">
        <div className="row-header">
          <h2 className="t-title2">{title}</h2>
        </div>
        <EmptyState action={{ label: "Try Again", onClick: retry }}>Anime results couldn't load.</EmptyState>
      </section>
    );
  if (!loading && !items?.length) return null;
  return <Shelf title={title} items={items} card={(a) => <AnimeCard key={a.id} item={a} />} />;
}
