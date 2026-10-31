import { PosterCard } from "../components/PosterCard";
import { useLibrary } from "../lib/queries";

export function Library() {
  const { data } = useLibrary();
  return (
    <div className="scroll">
      <header className="screen-header">
        <h1 className="t-title1">Library</h1>
      </header>
      {data?.length === 0 && (
        <p className="empty t-body muted">Titles you save appear here. Use “Add to Library” on any title.</p>
      )}
      <div className="grid">
        {data?.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
