import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { PosterCard, PosterSkeleton } from "../components/PosterCard";
import { Segmented } from "../components/Segmented";
import { Dropdown } from "../components/Dropdown";
import { api } from "../lib/api";
import { BROWSE_GENRES } from "../lib/genres";
import type { ContentType } from "../lib/types";
import { EmptyState } from "../components/ui/EmptyState";

const CATALOGS = [
  { id: "trending", label: "Trending" },
  { id: "popular", label: "Popular" },
  { id: "top_rated", label: "Top Rated" },
  { id: "new", label: "New" },
  { id: "gems", label: "Hidden Gems" },
  { id: "classics", label: "Classics" },
];

export function Discover({ type }: { type: ContentType }) {
  const [catalog, setCatalog] = useState("trending");
  const [picked, setGenre] = useState<string>();
  const sentinel = useRef<HTMLDivElement>(null);
  // Movies and Series share this screen: a genre from one may not exist in the other.
  const genre = picked && BROWSE_GENRES[type].includes(picked) ? picked : undefined;

  const query = useInfiniteQuery({
    queryKey: ["discover", type, catalog, genre ?? ""],
    queryFn: ({ pageParam }) => api.catalog(type, catalog, pageParam, genre),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length ? pages.flat().length : undefined),
    // Switching catalogs quickly: keep the last grid up (dimmed) instead of
    // collapsing to skeletons and back, which jolts the page each time.
    placeholderData: keepPreviousData,
  });

  // Load the next page well before the user hits the bottom.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => e.isIntersecting && query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage(),
      { rootMargin: "1200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  // Dedupe across pages — upstream catalogs occasionally repeat items.
  const seen = new Set<string>();
  const items = (query.data?.pages.flat() ?? []).filter((m) => !seen.has(m.id) && seen.add(m.id));

  return (
    <div className="scroll">
      <header className="screen-header">
        <h1 className="t-title1">{type === "movie" ? "Movies" : "Series"}</h1>
        <div className="discover-controls">
          <Dropdown
            label="Genre"
            value={genre ?? ""}
            onChange={(v) => setGenre(v || undefined)}
            options={[{ value: "", label: "All Genres" }, ...BROWSE_GENRES[type].map((g) => ({ value: g, label: g }))]}
          />
          <Segmented options={CATALOGS} value={catalog} onChange={setCatalog} label="Catalog" />
        </div>
      </header>
      <div className="poster-grid discover-grid" data-stale={query.isPlaceholderData}>
        {items.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
        {(query.isLoading || query.isFetchingNextPage) &&
          Array.from({ length: 12 }, (_, i) => <PosterSkeleton key={`s${i}`} />)}
      </div>
      {query.isError && <EmptyState>Couldn't load this catalog. Check your connection.</EmptyState>}
      <div ref={sentinel} />
    </div>
  );
}
