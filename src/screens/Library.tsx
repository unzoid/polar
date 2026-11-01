import { PosterCard } from "../components/PosterCard";
import { useLibrary } from "../lib/queries";

export function Library() {
  const { data } = useLibrary();
  return (
    <div className="scroll">
      <header className="screen-header">
        <h1 className="t-title1">My List</h1>
      </header>
      {data?.length === 0 && <p className="empty t-body muted">Titles you add to My List appear here.</p>}
      <div className="poster-grid">
        {data?.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
