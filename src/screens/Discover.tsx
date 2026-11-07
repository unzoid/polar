import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PosterCard } from "../components/PosterCard";
import { PosterGrid } from "../components/title/PosterGrid";
import { Segmented } from "../components/Segmented";
import { Dropdown } from "../components/Dropdown";
import { api } from "../lib/api";
import { BROWSE_GENRES, browsable, catalogExtra, catalogItems, catalogKey, catalogTitle, useAddonCatalogs } from "../lib/catalog";
import type { ContentType, MetaPreview } from "../lib/types";
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

/**
 * `catalog` and `genre`: where it opens (a Home shelf's heading opens its own list, #48). With `addon`, `catalog` is
 * one of that add-on's (#206): the List menu picks between Polarity's catalogs and the add-ons' that can be browsed,
 * whose genres are their own and whose pages follow `skip` when they declare it.
 */
export function Discover({
  type,
  catalog: initialCatalog,
  genre: initialGenre,
  addon: initialAddon,
}: {
  type: ContentType;
  catalog?: string;
  genre?: string;
  addon?: string;
}) {
  const [catalog, setCatalog] = useState(() => (CATALOGS.some((c) => c.id === initialCatalog) ? initialCatalog! : "trending"));
  const [picked, setGenre] = useState(initialGenre);
  const lists = useAddonCatalogs().filter((c) => c.type === type && browsable(c));
  const [list, setList] = useState(() => (initialAddon && initialCatalog ? catalogKey({ addon: initialAddon, type, id: initialCatalog }) : ""));
  // Movies and Series share this screen: a list or genre from one may not exist in the other.
  const own = lists.find((c) => catalogKey(c) === list);
  const genres = own ? own.genres : BROWSE_GENRES[type];
  const genre = picked && genres.includes(picked) ? picked : own?.genreRequired ? own.genres[0] : undefined;

  const query = useInfiniteQuery({
    queryKey: own ? keys.addonCatalogPages(own.addon, type, own.id, genre) : keys.discover(type, catalog, genre),
    queryFn: ({ pageParam }) =>
      own ? api.addonCatalog(own.addon, type, own.id, catalogExtra(own, { genre, skip: pageParam })) : api.catalog(type, catalog, pageParam, genre),
    initialPageParam: 0,
    // An add-on without `skip` answers with its whole list; one that ignores `skip` would repeat its page forever.
    getNextPageParam: (last: MetaPreview[], pages) => {
      if (!last.length || (own && !own.pages)) return undefined;
      const before = new Set(pages.slice(0, -1).flat().map((m) => m.id));
      return last.some((m) => !before.has(m.id)) ? pages.flat().length : undefined;
    },
    // Switching catalogs quickly: keep the last grid up (dimmed) instead of
    // collapsing to skeletons and back, which jolts the page each time.
    placeholderData: keepPreviousData,
  });

  // Dedupe across pages — upstream catalogs occasionally repeat items.
  const seen = new Set<string>();
  const all = query.data?.pages.flat() ?? [];
  const items = own ? catalogItems(own, all) : all.filter((m) => !seen.has(m.id) && seen.add(m.id));

  return (
    <div className="scroll">
      <header className="screen-header">
        <h1 className="t-title1">{type === "movie" ? "Movies" : "Series"}</h1>
        <div className="discover-controls">
          {!!lists.length && (
            <Dropdown
              label="List"
              value={own ? list : ""}
              onChange={setList}
              options={[{ value: "", label: "Polarity" }, ...lists.map((c) => ({ value: catalogKey(c), label: catalogTitle(c) }))]}
            />
          )}
          {!!genres.length && (
            <Dropdown
              label="Genre"
              value={genre ?? ""}
              onChange={(v) => setGenre(v || undefined)}
              options={[...(own?.genreRequired ? [] : [{ value: "", label: "All Genres" }]), ...genres.map((g) => ({ value: g, label: g }))]}
            />
          )}
          {!own && <Segmented options={CATALOGS} value={catalog} onChange={setCatalog} label="Catalog" />}
        </div>
      </header>
      <PosterGrid pager={query} stale={query.isPlaceholderData}>
        {items.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </PosterGrid>
      {query.isError && (
        <EmptyState>{own ? `${own.addonName} didn't send this list. Try again later.` : "Couldn't load this catalog. Check your connection."}</EmptyState>
      )}
    </div>
  );
}
