import { Menu } from "@base-ui/react/menu";
import { useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import { addToPlaylist, createPlaylist, removeFromPlaylist, usePlaylists } from "../lib/playlists";
import { useRouter } from "../lib/router";
import { useTitleActions } from "../lib/titleActions";
import type { MetaPreview, Progress } from "../lib/types";
import { Check, ChevronRight, Close, Info, Minus, Play, PlaylistIcon, Plus, Reset, Trailer, Watched } from "./icons";
import { imdbUrl } from "./RatingRing";
import { trailerFor } from "../lib/trailers";
import { openTrailer } from "./Trailer";

/**
 * A title's options on right-click (or the Menu key) in desktop mode: the
 * same choices as TV mode's options menu, as a small menu at the pointer.
 * One menu for the whole app, so a grid of hundreds of cards costs nothing.
 */

interface Target {
  item: MetaPreview;
  /** The progress the card stands for (Continue Watching): adds that episode's own actions. */
  entry?: Progress;
  /** Opened on an episode of the show's own page, not a Continue Watching card. */
  episode?: boolean;
  /** Where "Go to Show" leads, when not the title's own page (an anime's AniList page). */
  open?: () => void;
  x: number;
  y: number;
  key: number;
}

let current: Target | null = null;
let opened = 0;
const listeners = new Set<() => void>();
const set = (next: Target | null) => {
  current = next;
  listeners.forEach((l) => l());
};

/** Where a context-menu event points; from the keyboard (Menu key, Shift+F10) there's no pointer, so at the card. */
export function menuPoint(e: ReactMouseEvent<HTMLElement>) {
  let { clientX: x, clientY: y } = e;
  if (!x && !y) {
    const r = e.currentTarget.getBoundingClientRect();
    x = r.left + Math.min(32, r.width / 2);
    y = r.top + Math.min(32, r.height / 2);
  }
  return { x, y };
}

/** Opens the menu for `item` at `at`, for cards that work out their title first. */
export function openCardMenu(item: MetaPreview, at: { x: number; y: number }, open?: () => void) {
  set({ item, open, ...at, key: ++opened });
}

/** Spread on a card: `<button {...cardMenu(item)}>`. */
export function cardMenu(item: MetaPreview, entry?: Progress, { episode = false } = {}) {
  return {
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      set({ item, entry, episode, ...menuPoint(e), key: ++opened });
    },
  };
}

export function CardMenuHost() {
  const target = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  if (!target) return null;
  return <OpenMenu key={target.key} target={target} />;
}

function OpenMenu({ target }: { target: Target }) {
  const { item, entry, episode, open, x, y } = target;
  const { navigate } = useRouter();
  const a = useTitleActions(item, entry);
  const playlists = usePlaylists();
  const close = () => set(null);
  // A zero-size point where the pointer was.
  const anchor = { getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) };
  const imdb = imdbUrl(item.id);

  return (
    <Menu.Root open modal={false} onOpenChange={(open) => !open && close()}>
      <Menu.Portal>
        <Menu.Positioner anchor={anchor} side="bottom" align="start" sideOffset={2} collisionPadding={12} className="select-positioner">
          <Menu.Popup className="ctx-menu" aria-label={`${item.name} options`}>
            <div className="ctx-menu-head">
              <strong>{item.name}</strong>
              {a.episodeLabel && entry && (
                <span>
                  {a.episodeLabel}
                  {entry.episodeTitle ? ` · ${entry.episodeTitle}` : ""}
                </span>
              )}
            </div>
            {entry && (
              <Item
                icon={<Play />}
                label={a.entryInProgress ? "Resume" : "Play"}
                onClick={() => navigate({ name: "player", type: entry.type, metaId: entry.metaId, videoId: entry.videoId, stream: entry.stream })}
              />
            )}
            <Item
              icon={<Info />}
              label={a.isSeries ? "Go to Show" : "Go to Movie"}
              onClick={open ?? (() => navigate({ name: "detail", type: item.type, id: item.id, preview: item }))}
            />
            {(a.trailerYtId || item.id.startsWith("tt")) && (
              <Item icon={<Trailer />} label="Play Trailer" onClick={() => openTrailer(trailerFor(item.name, item.id, a))} />
            )}

            <Menu.Separator className="ctx-menu-sep" />
            {a.episodeUnwatched && <Item icon={<Watched />} label={`Mark ${a.episodeLabel} as Watched`} onClick={a.markEpisodeWatched} />}
            {a.episodeWatched && <Item icon={<Reset />} label={`Mark ${a.episodeLabel} as Unwatched`} onClick={a.markEpisodeUnwatched} />}
            <Item
              icon={a.allWatched ? <Reset /> : <Watched />}
              label={`Mark ${a.isSeries ? "Show " : ""}as ${a.allWatched ? "Unwatched" : "Watched"}`}
              disabled={!a.canToggleWatched}
              onClick={a.toggleWatched}
            />
            {a.entryInProgress && (
              <Item
                icon={episode ? <Reset /> : <Close />}
                label={episode ? `Reset ${a.episodeLabel} Progress` : "Remove from Continue Watching"}
                onClick={a.resetEntry}
              />
            )}
            {a.hasProgress && !a.allWatched && (
              <Item icon={<Reset />} label={a.isSeries ? "Reset Show Progress" : "Reset Progress"} onClick={a.resetAll} />
            )}

            <Menu.Separator className="ctx-menu-sep" />
            <Item
              icon={a.inLibrary ? <Minus /> : <Plus />}
              label={a.inLibrary ? "Remove from Library" : "Add to Library"}
              onClick={a.toggleLibrary}
            />
            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger className="ctx-menu-item">
                {a.inPlaylist ? <Check /> : <PlaylistIcon />}
                <span>{a.inPlaylist ? "Playlists" : "Add to Playlist"}</span>
                <ChevronRight className="ctx-menu-chevron" />
              </Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner sideOffset={0} alignOffset={-5} collisionPadding={12} className="select-positioner">
                  <Menu.Popup className="ctx-menu">
                    {playlists.map((p) => {
                      const has = p.items.some((i) => i.id === item.id);
                      return (
                        <Menu.CheckboxItem
                          key={p.id}
                          className="ctx-menu-item"
                          checked={has}
                          closeOnClick={false}
                          onCheckedChange={(on) => (on ? addToPlaylist(p.id, item) : removeFromPlaylist(p.id, item.id))}
                        >
                          <span className="ctx-menu-check">{has && <Check />}</span>
                          <span>{p.name}</span>
                          <span className="ctx-menu-meta tabular">{p.items.length}</span>
                        </Menu.CheckboxItem>
                      );
                    })}
                    {playlists.length > 0 && <Menu.Separator className="ctx-menu-sep" />}
                    <Item icon={<Plus />} label="New Playlist" onClick={() => createPlaylist(freshName(playlists.map((p) => p.name)), item)} />
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>

            {imdb && (
              <>
                <Menu.Separator className="ctx-menu-sep" />
                <Item icon={<ExternalGlyph />} label="Open on IMDb" onClick={() => void api.openExternal(imdb)} />
                {item.type === "movie" && (
                  <Item icon={<ExternalGlyph />} label="Open on Letterboxd" onClick={() => void api.openExternal(letterboxdUrl(item.id))} />
                )}
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Item({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Menu.Item className="ctx-menu-item" disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </Menu.Item>
  );
}

/** Letterboxd finds a film by its IMDb id. */
export const letterboxdUrl = (imdbId: string) => `https://letterboxd.com/imdb/${imdbId}/`;

/** "New Playlist", or "New Playlist 2" and so on if that's taken. */
function freshName(taken: string[]) {
  const names = new Set(taken);
  let n = 1;
  while (names.has(n === 1 ? "New Playlist" : `New Playlist ${n}`)) n++;
  return n === 1 ? "New Playlist" : `New Playlist ${n}`;
}

/** An arrow out of a box: "opens in your browser". */
function ExternalGlyph() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden data-slot="icon">
      <path
        fillRule="evenodd"
        d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Zm7.25-.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V6.56l-5.22 5.22a.75.75 0 1 1-1.06-1.06l5.22-5.22h-1.69a.75.75 0 0 1-.75-.75Z"
      />
    </svg>
  );
}
