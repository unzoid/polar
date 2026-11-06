import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PosterCard } from "../components/PosterCard";
import { PosterGrid } from "../components/title/PosterGrid";
import { Segmented } from "../components/Segmented";
import { Dropdown } from "../components/Dropdown";
import { api } from "../lib/api";
import { BROWSE_GENRES } from "../lib/catalog";
import type { ContentType } from "../lib/types";
import { EmptyState } from "../components/ui/EmptyState";
import { keys } from "../lib/net";

const CATALOGS = [
  { id: "trending", label: "Trending" },
  { id: "popular", label: "Popular" },
  { id: "top_rated", label: "Top Rated" },
  { id: "new", label: "New" },
  { id: "gems", label: "Hidden Gems" },
  { id: "classics", label: "Classics" },
];

/** `catalog` and `genre`: where it opens (a Home shelf's heading opens its own list, #48). */
export function Discover({ type, catalog: initialCatalog, genre: initialGenre }: { type: ContentType; catalog?: string; genre?: string }) {
  const [catalog, setCatalog] = useState(() => (CATALOGS.some((c) => c.id === initialCatalog) ? initialCatalog! : "trending"));
  const [picked, setGenre] = useState(initialGenre);
  // Movies and Series share this screen: a genre from one may not exist in the other.
  const genre = picked && BROWSE_GENRES[type].includes(picked) ? picked : undefined;

  const query = useInfiniteQuery({
    queryKey: keys.discover(type, catalog, genre),
    queryFn: ({ pageParam }) => api.catalog(type, catalog, pageParam, genre),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length ? pages.flat().length : undefined),
    // Switching catalogs quickly: keep the last grid up (dimmed) instead of
    // collapsing to skeletons and back, which jolts the page each time.
    placeholderData: keepPreviousData,
  });

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
      <PosterGrid pager={query} stale={query.isPlaceholderData}>
        {items.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </PosterGrid>
      {query.isError && <EmptyState>Couldn't load this catalog. Check your connection.</EmptyState>}
    </div>
  );
}
