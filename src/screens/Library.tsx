import { useMemo, useState } from "react";
import { Dropdown } from "../components/Dropdown";
import { ConfirmDeleteButton } from "../components/ConfirmDeleteButton";
import { ChevronLeft, Close, Plus } from "../components/icons";
import { PlaylistTile, usePlaylistItem } from "../components/Playlists";
import { PosterCard } from "../components/PosterCard";
import { Row } from "../components/Row";
import { Segmented } from "../components/Segmented";
import {
  createPlaylist,
  deletePlaylist,
  removeFromPlaylist,
  renamePlaylist,
  usePlaylists,
  type PlaylistItem,
} from "../lib/playlists";
import { useLibrary, useWatchHistory } from "../lib/queries";
import { progressFraction, progressItem, useLibraryRecommendations } from "../lib/shelves";
import type { ContentType } from "../lib/types";

type View = "saved" | "watched" | "playlists";
type Kind = "all" | ContentType;
type Sort = "recent" | "title";

const VIEWS: { id: View; label: string }[] = [
  { id: "saved", label: "Saved" },
  { id: "watched", label: "Watched" },
  { id: "playlists", label: "Playlists" },
];

const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "series", label: "Shows" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "title", label: "Title" },
];

/**
 * A plain library: what you've saved, what you've watched, your playlists.
 * One quiet row of suggestions sits under the saved titles; the rest of the
 * page is yours.
 */
export function Library() {
  const [view, setView] = useState<View>("saved");
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [openPlaylist, setOpenPlaylist] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const filters = view !== "playlists";

  return (
    <div className="scroll">
      <header className="screen-header library-header">
        <h1 className="t-title1">Library</h1>
        <Segmented
          options={VIEWS}
          value={view}
          onChange={(v) => {
            setView(v);
            setOpenPlaylist(null);
          }}
          label="Library view"
        />
      </header>
      {filters && (
        <div className="library-toolbar">
          <Dropdown label="Show" value={kind} onChange={setKind} options={KINDS} />
          <Dropdown label="Sort by" value={sort} onChange={setSort} options={SORTS} />
        </div>
      )}
      {view === "saved" && <Saved kind={kind} sort={sort} />}
      {view === "watched" && <Watched kind={kind} sort={sort} />}
      {view === "playlists" &&
        (openPlaylist ? (
          <PlaylistView id={openPlaylist} fresh={fresh} onClose={() => setOpenPlaylist(null)} />
        ) : (
          <Playlists
            onOpen={(id, isNew = false) => {
              setFresh(isNew);
              setOpenPlaylist(id);
            }}
          />
        ))}
    </div>
  );
}

function arrange<T extends { type: ContentType; name: string }>(items: T[] | undefined, kind: Kind, sort: Sort) {
  if (!items) return undefined;
  const shown = kind === "all" ? items : items.filter((i) => i.type === kind);
  return sort === "title" ? [...shown].sort((a, b) => a.name.localeCompare(b.name)) : shown;
}

function Saved({ kind, sort }: { kind: Kind; sort: Sort }) {
  const { data } = useLibrary();
  const items = useMemo(() => arrange(data, kind, sort), [data, kind, sort]);
  if (data?.length === 0) {
    return <p className="empty t-body muted">Titles you save with + on their page appear here.</p>;
  }
  return (
    <>
      {items?.length === 0 && <p className="empty t-body muted">Nothing here yet.</p>}
      <div className="poster-grid">
        {items?.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </div>
      <Suggestions />
    </>
  );
}

/** The one nod to recommendations: a single row under your titles, built from them. */
function Suggestions() {
  const { forYou } = useLibraryRecommendations();
  if (!forYou?.length) return null;
  return (
    <div className="library-suggestions">
      <Row title="More Like Your Library" shape="poster">
        {forYou.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </Row>
    </div>
  );
}

function Watched({ kind, sort }: { kind: Kind; sort: Sort }) {
  const { data } = useWatchHistory();
  const items = useMemo(() => arrange(data, kind, sort), [data, kind, sort]);
  if (data?.length === 0) return <p className="empty t-body muted">Movies and shows you watch appear here.</p>;
  return (
    <>
      {items?.length === 0 && <p className="empty t-body muted">Nothing here yet.</p>}
      <div className="poster-grid">
        {items?.map((p) => (
          <PosterCard key={p.metaId} item={progressItem(p)} progress={progressFraction(p)} />
        ))}
      </div>
    </>
  );
}

function Playlists({ onOpen }: { onOpen: (id: string, isNew?: boolean) => void }) {
  const playlists = usePlaylists();
  return (
    <>
      {playlists.length === 0 && (
        <p className="empty t-body muted">
          Group titles into playlists from their page, or start one here.
        </p>
      )}
      <div className="poster-grid">
        {playlists.map((p) => (
          <PlaylistTile key={p.id} playlist={p} onOpen={() => onOpen(p.id)} />
        ))}
        <button className="card card-poster playlist-tile" onClick={() => onOpen(createPlaylist("New Playlist").id, true)}>
          <div className="card-frame playlist-new">
            <Plus size={28} />
            <span className="t-callout">New Playlist</span>
          </div>
        </button>
      </div>
    </>
  );
}

function PlaylistView({ id, fresh, onClose }: { id: string; fresh: boolean; onClose: () => void }) {
  const playlist = usePlaylists().find((p) => p.id === id);
  if (!playlist) return null;
  const n = playlist.items.length;

  return (
    <div className="playlist-view">
      <div className="playlist-view-head">
        <button className="playlist-back t-callout" onClick={onClose}>
          <ChevronLeft size={16} strokeWidth={2.25} />
          Playlists
        </button>
        <div className="playlist-view-title">
          <input
            key={playlist.name}
            className="playlist-name-input t-title2"
            defaultValue={playlist.name}
            maxLength={60}
            aria-label="Playlist name"
            // A new playlist starts with its name selected, ready to type over.
            autoFocus={fresh}
            onFocus={(e) => fresh && e.currentTarget.select()}
            onBlur={(e) => {
              if (e.target.value.trim()) renamePlaylist(id, e.target.value);
              else e.target.value = playlist.name;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.stopPropagation();
                e.currentTarget.value = playlist.name;
                e.currentTarget.blur();
              }
            }}
          />
          <span className="t-callout faint tabular">
            {n} {n === 1 ? "title" : "titles"}
          </span>
          <span className="playlist-view-spacer" />
          <ConfirmDeleteButton label="playlist" onConfirm={() => (deletePlaylist(id), onClose())} />
        </div>
      </div>
      {n === 0 ? (
        <p className="empty t-body muted">Add titles with the playlist button on their page.</p>
      ) : (
        <div className="poster-grid">
          {playlist.items.map((item) => (
            <PlaylistEntry key={item.id} playlistId={id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlaylistEntry({ playlistId, item }: { playlistId: string; item: PlaylistItem }) {
  const shown = usePlaylistItem(item);
  return (
    <div className="playlist-entry">
      <PosterCard item={shown ?? { id: item.id, type: item.type, name: "" }} />
      <button
        className="playlist-remove"
        aria-label={`Remove ${shown?.name ?? "title"} from playlist`}
        title="Remove from playlist"
        onClick={() => removeFromPlaylist(playlistId, item.id)}
      >
        <Close size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
}
