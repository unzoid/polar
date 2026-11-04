import { useState, type FormEvent } from "react";
import { useMeta } from "../lib/queries";
import {
  addToPlaylist,
  createPlaylist,
  removeFromPlaylist,
  usePlaylists,
  type Playlist,
  type PlaylistItem,
} from "../lib/playlists";
import type { MetaPreview } from "../lib/types";
import { Check, Plus, PlaylistIcon } from "./icons";
import { Img } from "./Img";
import { Button, buttonClass } from "./ui/Button";
import { PopoverPopup, PopoverRoot, PopoverTrigger } from "./ui/Popover";
import { TextField } from "./ui/TextField";

/**
 * A playlist title as something a card can draw. Titles added here carry
 * their name and poster; ones that arrived by sync (stored as bare ids) are
 * looked up.
 */
export function usePlaylistItem(item: PlaylistItem): MetaPreview | undefined {
  const known = !!(item.name && item.poster);
  const { data } = useMeta(item.type, item.id, !known);
  if (known) return { id: item.id, type: item.type, name: item.name!, poster: item.poster };
  return data ?? (item.name ? { id: item.id, type: item.type, name: item.name } : undefined);
}

/** Detail page button: tick the playlists a title belongs in, or start a new one. */
export function PlaylistButton({ item }: { item: MetaPreview }) {
  const playlists = usePlaylists();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const inAny = playlists.some((p) => p.items.some((i) => i.id === item.id));

  const create = (e: FormEvent) => {
    e.preventDefault();
    createPlaylist(name, item);
    setName("");
    setCreating(false);
  };

  return (
    <PopoverRoot
      onOpenChange={(open) => {
        if (!open) {
          setCreating(false);
          setName("");
        }
      }}
    >
      <PopoverTrigger
        className={buttonClass("glass", true)}
        aria-label="Add to playlist"
        title="Add to playlist"
        data-active={inAny || undefined}
      >
        <PlaylistIcon size={20} />
      </PopoverTrigger>
      <PopoverPopup sideOffset={8} align="start" className="playlist-menu">
        <p className="playlist-menu-title">Save to playlist</p>
        {playlists.length > 0 && (
          <div className="playlist-menu-list">
            {playlists.map((p) => {
              const has = p.items.some((i) => i.id === item.id);
              return (
                <button
                  key={p.id}
                  className="playlist-menu-item"
                  role="menuitemcheckbox"
                  aria-checked={has}
                  onClick={() => (has ? removeFromPlaylist(p.id, item.id) : addToPlaylist(p.id, item))}
                >
                  <span className="playlist-menu-check">{has && <Check size={14} strokeWidth={2.5} />}</span>
                  <span className="playlist-menu-name">{p.name}</span>
                  <span className="playlist-menu-count tabular">{p.items.length}</span>
                </button>
              );
            })}
          </div>
        )}
        {creating ? (
          <form className="playlist-menu-form" onSubmit={create}>
            <TextField
              autoFocus
              maxLength={60}
              placeholder="Playlist name"
              value={name}
              onChange={setName}
              onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setCreating(false))}
            />
            <Button variant="primary" disabled={!name.trim()}>
              Create
            </Button>
          </form>
        ) : (
          <button className="playlist-menu-item playlist-menu-new" onClick={() => setCreating(true)}>
            <span className="playlist-menu-check">
              <Plus size={15} strokeWidth={2.25} />
            </span>
            New Playlist
          </button>
        )}
      </PopoverPopup>
    </PopoverRoot>
  );
}

function CoverPoster({ item, className = "" }: { item: PlaylistItem; className?: string }) {
  const shown = usePlaylistItem(item);
  return shown?.poster ? (
    <Img src={shown.poster} alt="" className={className} />
  ) : (
    <span className={`playlist-fan-blank ${className}`} />
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 movies · 2 shows", or just "4 titles" when it's all one kind. */
function playlistSummary(items: PlaylistItem[]) {
  if (!items.length) return "Empty";
  const movies = items.filter((i) => i.type === "movie").length;
  const shows = items.filter((i) => i.type === "series").length;
  if (movies && shows) return `${plural(movies, "movie", "movies")} · ${plural(shows, "show", "shows")}`;
  if (movies === items.length) return plural(movies, "movie", "movies");
  if (shows === items.length) return plural(shows, "show", "shows");
  return plural(items.length, "title", "titles");
}

/**
 * A playlist in the Library: the first posters fanned out whole (never
 * cropped) over a blurred wash of the first one, with the name and contents
 * on the cover itself, so it reads as a playlist even with captions off.
 */
export function PlaylistTile({ playlist, onOpen }: { playlist: Playlist; onOpen: () => void }) {
  const covers = playlist.items.slice(0, 3);
  const summary = playlistSummary(playlist.items);
  return (
    <button className="card card-poster playlist-tile" onClick={onOpen} aria-label={`${playlist.name}, ${summary}`}>
      <div className="card-frame playlist-cover">
        <div className="playlist-cover-art">
          {covers.length ? (
            <>
              <CoverPoster item={covers[0]} className="playlist-cover-wash" />
              <div className="playlist-fan" data-count={covers.length}>
                {covers.map((i) => (
                  <CoverPoster key={i.id} item={i} />
                ))}
              </div>
            </>
          ) : (
            <PlaylistIcon size={40} className="playlist-cover-icon" />
          )}
        </div>
        <div className="playlist-cover-label">
          <span className="playlist-cover-name">{playlist.name}</span>
          <span className="playlist-cover-meta tabular">{summary}</span>
        </div>
      </div>
    </button>
  );
}
