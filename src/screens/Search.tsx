import { useDeferredValue, useEffect, useState } from "react";
import { PosterCard, PosterSkeleton } from "../components/PosterCard";
import { useSearch } from "../lib/queries";
import { useSearchText } from "../lib/searchQuery";
import type { MetaPreview } from "../lib/types";

/** Results for whatever is typed in the navbar's search field. */
export function Search() {
  const text = useSearchText();
  const [query, setQuery] = useState(text.trim());
  const deferred = useDeferredValue(query);

  // Keystrokes update the field instantly; the network waits for a pause.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text.trim()), 180);
    return () => window.clearTimeout(t);
  }, [text]);

  const { data } = useSearch(deferred);
  const hasQuery = deferred.length > 1;

  return (
    <div className="scroll search-page">
      {/* Skeletons while typing or waiting; nothing until there's a real query. */}
      {text.trim().length > 1 && (!hasQuery || !data) && <ResultGrid title="Results" loading />}
      {hasQuery && data && (
        <>
          <ResultGrid title="Movies" items={data.movies} />
          <ResultGrid title="Series" items={data.series} />
          {!data.movies.length && !data.series.length && (
            <p className="empty t-body muted">Nothing found for “{deferred}”.</p>
          )}
        </>
      )}
    </div>
  );
}

function ResultGrid({ title, items, loading }: { title: string; items?: MetaPreview[]; loading?: boolean }) {
  if (!loading && !items?.length) return null;
  return (
    <section className="grid-section">
      <h2 className="t-title2 grid-title">{title}</h2>
      <div className="poster-grid">
        {loading
          ? Array.from({ length: 12 }, (_, i) => <PosterSkeleton key={i} />)
          : items!.map((item) => <PosterCard key={item.id} item={item} />)}
      </div>
    </section>
  );
}
