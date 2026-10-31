import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { PosterCard, PosterSkeleton } from "../components/PosterCard";
import { Segmented } from "../components/Segmented";
import { api } from "../lib/api";
import type { ContentType } from "../lib/types";

const CATALOGS = [
  { id: "trending", label: "Trending" },
  { id: "popular", label: "Popular" },
  { id: "top_rated", label: "Top Rated" },
];

export function Discover({ type }: { type: ContentType }) {
  const [catalog, setCatalog] = useState("trending");
  const sentinel = useRef<HTMLDivElement>(null);

  const query = useInfiniteQuery({
    queryKey: ["discover", type, catalog],
    queryFn: ({ pageParam }) => api.catalog(type, catalog, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length ? pages.flat().length : undefined),
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
        <Segmented options={CATALOGS} value={catalog} onChange={setCatalog} label="Catalog" />
      </header>
      <div className="grid">
        {items.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
        {(query.isLoading || query.isFetchingNextPage) &&
          Array.from({ length: 12 }, (_, i) => <PosterSkeleton key={`s${i}`} />)}
      </div>
      {query.isError && <p className="empty t-body muted">Couldn't load this catalog. Check your connection.</p>}
      <div ref={sentinel} />
    </div>
  );
}
