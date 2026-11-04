import { useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import { api } from "../lib/api";
import { useRouter } from "../lib/router";
import { useTitleActions } from "../lib/library";
import type { MetaPreview, Progress } from "../lib/types";
import { Check, Close, Info, Minus, Play, PlaylistIcon, Plus, Reset, Trailer, Watched } from "./icons";
import { PlaylistChecklist } from "./title/PlaylistChecklist";
import { imdbUrl } from "./RatingRing";
import { trailerFor } from "../lib/playback";
import { openTrailer } from "./Trailer";
import { MenuHeader, MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuSub } from "./ui/Menu";

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
  const close = () => set(null);
  // A zero-size point where the pointer was.
  const anchor = { getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) };
  const imdb = imdbUrl(item.id);

  return (
    <MenuRoot open modal={false} onOpenChange={(open) => !open && close()}>
      <MenuPopup anchor={anchor} side="bottom" align="start" sideOffset={2} collisionPadding={12} aria-label={`${item.name} options`}>
        <MenuHeader
          title={item.name}
          detail={a.episodeLabel && entry && `${a.episodeLabel}${entry.episodeTitle ? ` · ${entry.episodeTitle}` : ""}`}
        />
        {entry && (
          <MenuItem
            icon={<Play />}
            onClick={() => navigate({ name: "player", type: entry.type, metaId: entry.metaId, videoId: entry.videoId, stream: entry.stream })}
          >
            {a.entryInProgress ? "Resume" : "Play"}
          </MenuItem>
        )}
        <MenuItem icon={<Info />} onClick={open ?? (() => navigate({ name: "detail", type: item.type, id: item.id, preview: item }))}>
          {a.isSeries ? "Go to Show" : "Go to Movie"}
        </MenuItem>
        {(a.trailerYtId || item.id.startsWith("tt")) && (
          <MenuItem icon={<Trailer />} onClick={() => openTrailer(trailerFor(item.name, item.id, a))}>
            Play Trailer
          </MenuItem>
        )}

        <MenuSeparator />
        {a.episodeUnwatched && (
          <MenuItem icon={<Watched />} onClick={a.markEpisodeWatched}>
            Mark {a.episodeLabel} as Watched
          </MenuItem>
        )}
        {a.episodeWatched && (
          <MenuItem icon={<Reset />} onClick={a.markEpisodeUnwatched}>
            Mark {a.episodeLabel} as Unwatched
          </MenuItem>
        )}
        <MenuItem icon={a.allWatched ? <Reset /> : <Watched />} disabled={!a.canToggleWatched} onClick={a.toggleWatched}>
          Mark {a.isSeries ? "Show " : ""}as {a.allWatched ? "Unwatched" : "Watched"}
        </MenuItem>
        {a.entryInProgress && (
          <MenuItem icon={episode ? <Reset /> : <Close />} onClick={a.resetEntry}>
            {episode ? `Reset ${a.episodeLabel} Progress` : "Remove from Continue Watching"}
          </MenuItem>
        )}
        {a.hasProgress && !a.allWatched && (
          <MenuItem icon={<Reset />} onClick={a.resetAll}>
            {a.isSeries ? "Reset Show Progress" : "Reset Progress"}
          </MenuItem>
        )}

        <MenuSeparator />
        <MenuItem icon={a.inLibrary ? <Minus /> : <Plus />} onClick={a.toggleLibrary}>
          {a.inLibrary ? "Remove from Library" : "Add to Library"}
        </MenuItem>
        <MenuSub icon={a.inPlaylist ? <Check /> : <PlaylistIcon />} label={a.inPlaylist ? "Playlists" : "Add to Playlist"}>
          <PlaylistChecklist item={item} look="menu" />
        </MenuSub>

        {imdb && (
          <>
            <MenuSeparator />
            <MenuItem icon={<ExternalGlyph />} onClick={() => void api.openExternal(imdb)}>
              Open on IMDb
            </MenuItem>
            {item.type === "movie" && (
              <MenuItem icon={<ExternalGlyph />} onClick={() => void api.openExternal(letterboxdUrl(item.id))}>
                Open on Letterboxd
              </MenuItem>
            )}
          </>
        )}
      </MenuPopup>
    </MenuRoot>
  );
}

/** Letterboxd finds a film by its IMDb id. */
export const letterboxdUrl = (imdbId: string) => `https://letterboxd.com/imdb/${imdbId}/`;

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
