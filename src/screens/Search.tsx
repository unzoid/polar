import { Search as SearchIcon, X } from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { PosterCard, PosterSkeleton } from "../components/PosterCard";
import { useSearch } from "../lib/queries";
import type { MetaPreview } from "../lib/types";

export function Search() {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);

  // Keystrokes update the field instantly; the network waits for a pause.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(text.trim()), 180);
    return () => window.clearTimeout(t);
  }, [text]);

  useEffect(() => input.current?.focus(), []);

  const { data, isFetching } = useSearch(deferred);
  const hasQuery = deferred.length > 1;

  return (
    <div className="scroll">
      <header className="screen-header search-header">
        <label className="search-field">
          <SearchIcon size={20} className="faint" />
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Movies, series…"
            spellCheck={false}
            className="t-title2"
            onKeyDown={(e) => e.key === "Escape" && setText("")}
          />
          {text && (
            <button className="search-clear pressable" onClick={() => setText("")} aria-label="Clear">
              <X size={16} />
            </button>
          )}
          <span className="search-spinner" data-active={isFetching} aria-hidden />
        </label>
      </header>

      {!hasQuery && <p className="empty t-body faint">Search across every movie and series.</p>}
      {hasQuery && !data && <ResultGrid title="Results" loading />}
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
      <div className="grid">
        {loading
          ? Array.from({ length: 12 }, (_, i) => <PosterSkeleton key={i} />)
          : items!.map((item) => <PosterCard key={item.id} item={item} />)}
      </div>
    </section>
  );
}
