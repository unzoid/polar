import { useMeta } from "../lib/net";
import type { Playlist, PlaylistItem } from "../lib/library";
import type { MetaPreview } from "../lib/types";
import { PlaylistIcon } from "./icons";
import { Img } from "./Img";
import { PlaylistChecklist, usePlaylistChecklist } from "./title/PlaylistChecklist";
import { buttonClass } from "./ui/Button";
import { PopoverPopup, PopoverRoot, PopoverTrigger } from "./ui/Popover";

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
  const { inAny } = usePlaylistChecklist(item);
  return (
    <PopoverRoot>
      <PopoverTrigger
        className={buttonClass("glass", true)}
        aria-label="Add to playlist"
        title="Add to playlist"
        data-active={inAny || undefined}
      >
        <PlaylistIcon size={20} />
      </PopoverTrigger>
      {/* Centred under its round button, as the download menu beside it is; kept off the screen's edges. */}
      <PopoverPopup sideOffset={8} align="center" collisionPadding={12} className="playlist-menu">
        <p className="playlist-menu-title">Save to playlist</p>
        <PlaylistChecklist item={item} look="popover" />
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
