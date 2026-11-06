import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import { useRouter } from "../lib/router";
import { useTitleActions } from "../lib/library";
import type { MetaPreview, Progress } from "../lib/types";
import { Check, Close, Info, Minus, Play, PlaylistIcon, Plus, Reset, Trailer, Watched } from "./icons";
import { PlaylistChecklist, usePlaylistChecklist } from "./title/PlaylistChecklist";
import { nativeDialogsAvailable, showNativeDialog } from "../lib/platform";
import { warnFailed } from "../lib/errors";
import { imdbUrl } from "./RatingRing";
import { trailerFor } from "../lib/playback";
import { openTrailer } from "./Trailer";
import { MenuHeader, MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuSub } from "./ui/Menu";

/**
 * A title's options on right-click (or the Menu key) in desktop mode, and on a
 * long press on iOS: the same choices as TV mode's options menu, as a small menu
 * at the pointer, or on iOS as the system's action sheet. One menu for the whole
 * app, so a grid of hundreds of cards costs nothing.
 */

interface Target {
  item: MetaPreview;
  /** The progress the card stands for (Continue Watching): adds that episode's own actions. */
  entry?: Progress;
  /** Opened on an episode of the show's own page, not a Continue Watching card. */
  episode?: boolean;
  /** Where "Go to Show" leads, when not the title's own page (an anime's AniList page). */
  open?: () => void;
  /** False when the title has no id the library knows (an anime with no IMDb or Kitsu link): only "Go to Show". */
  linked?: boolean;
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
export function openCardMenu(item: MetaPreview, at: { x: number; y: number }, open?: () => void, { linked = true } = {}) {
  set({ item, open, linked, ...at, key: ++opened });
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
  if (target.linked === false) return <UnlinkedMenu key={target.key} target={target} />;
  return <OpenMenu key={target.key} target={target} />;
}

/** A zero-size point where the pointer was. */
const pointAnchor = (x: number, y: number) => ({ getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) });

/**
 * One of a title's choices. The web menu draws them with their icons; iOS lists them in its action sheet.
 * `playlists` is the Add to Playlist submenu, a second sheet on iOS.
 */
type Choice = { id: string; label: string; icon: ReactNode; run?: () => void; disabled?: boolean; destructive?: boolean; playlists?: boolean };
/** The choices in groups, a separator between groups. */
type Choices = { detail?: string; groups: Choice[][]; settled: boolean };

const goTo = (target: Target, navigate: ReturnType<typeof useRouter>["navigate"], series: boolean): Choice => ({
  id: "open",
  label: series ? "Go to Show" : "Go to Movie",
  icon: <Info />,
  run: target.open ?? (() => navigate({ name: "detail", type: target.item.type, id: target.item.id, preview: target.item })),
});

/** The menu of a title nothing else can be done with yet: its page. */
function useUnlinkedChoices(target: Target): Choices {
  const { navigate } = useRouter();
  return { groups: [[goTo(target, navigate, target.item.type === "series")]], settled: true };
}

function useLinkedChoices(target: Target): Choices {
  const { item, entry, episode } = target;
  const { navigate } = useRouter();
  const a = useTitleActions(item, entry);
  const imdb = imdbUrl(item.id);
  const play: Choice[] = [];
  if (entry)
    play.push({
      id: "play",
      label: a.entryInProgress ? "Resume" : "Play",
      icon: <Play />,
      run: () => navigate({ name: "player", type: entry.type, metaId: entry.metaId, videoId: entry.videoId, stream: entry.stream }),
    });
  play.push(goTo(target, navigate, a.isSeries));
  if (a.trailerYtId || item.id.startsWith("tt"))
    play.push({ id: "trailer", label: "Play Trailer", icon: <Trailer />, run: () => openTrailer(trailerFor(item.name, item.id, a)) });

  const watched: Choice[] = [];
  if (a.episodeUnwatched) watched.push({ id: "episode-watched", label: `Mark ${a.episodeLabel} as Watched`, icon: <Watched />, run: a.markEpisodeWatched });
  if (a.episodeWatched) watched.push({ id: "episode-unwatched", label: `Mark ${a.episodeLabel} as Unwatched`, icon: <Reset />, run: a.markEpisodeUnwatched });
  watched.push({
    id: "watched",
    label: `Mark ${a.isSeries ? "Show " : ""}as ${a.allWatched ? "Unwatched" : "Watched"}`,
    icon: a.allWatched ? <Reset /> : <Watched />,
    disabled: !a.canToggleWatched,
    run: a.toggleWatched,
  });
  if (a.entryInProgress)
    watched.push({
      id: "reset-entry",
      label: episode ? `Reset ${a.episodeLabel} Progress` : "Remove from Continue Watching",
      icon: episode ? <Reset /> : <Close />,
      destructive: !episode,
      run: a.resetEntry,
    });
  if (a.hasProgress && !a.allWatched)
    watched.push({ id: "reset-all", label: a.isSeries ? "Reset Show Progress" : "Reset Progress", icon: <Reset />, run: a.resetAll });

  const keep: Choice[] = [
    {
      id: "library",
      label: a.inLibrary ? "Remove from Library" : "Add to Library",
      icon: a.inLibrary ? <Minus /> : <Plus />,
      destructive: a.inLibrary,
      run: a.toggleLibrary,
    },
    { id: "playlists", label: a.inPlaylist ? "Playlists" : "Add to Playlist", icon: a.inPlaylist ? <Check /> : <PlaylistIcon />, playlists: true },
  ];

  const out: Choice[] = [];
  if (imdb) {
    out.push({ id: "imdb", label: "Open on IMDb", icon: <ExternalGlyph />, run: () => void api.openExternal(imdb) });
    if (item.type === "movie")
      out.push({ id: "letterboxd", label: "Open on Letterboxd", icon: <ExternalGlyph />, run: () => void api.openExternal(letterboxdUrl(item.id)) });
  }

  return {
    detail: a.episodeLabel && entry ? `${a.episodeLabel}${entry.episodeTitle ? ` · ${entry.episodeTitle}` : ""}` : undefined,
    groups: [play, watched, keep, out].filter((g) => g.length),
    settled: a.settled,
  };
}

function UnlinkedMenu({ target }: { target: Target }) {
  const choices = useUnlinkedChoices(target);
  return nativeDialogsAvailable ? <NativeMenu target={target} choices={choices} /> : <WebMenu target={target} choices={choices} />;
}

function OpenMenu({ target }: { target: Target }) {
  const choices = useLinkedChoices(target);
  return nativeDialogsAvailable ? <NativeMenu target={target} choices={choices} /> : <WebMenu target={target} choices={choices} />;
}

function WebMenu({ target, choices }: { target: Target; choices: Choices }) {
  const { item, x, y } = target;
  return (
    <MenuRoot open modal={false} onOpenChange={(open) => !open && set(null)}>
      <MenuPopup anchor={pointAnchor(x, y)} side="bottom" align="start" sideOffset={2} collisionPadding={12} aria-label={`${item.name} options`}>
        <MenuHeader title={item.name} detail={choices.detail} />
        {choices.groups.map((group, i) => (
          <Fragment key={group[0].id}>
            {i > 0 && <MenuSeparator />}
            {group.map((c) =>
              c.playlists ? (
                <MenuSub key={c.id} icon={c.icon} label={c.label}>
                  <PlaylistChecklist item={item} look="menu" />
                </MenuSub>
              ) : (
                <MenuItem key={c.id} icon={c.icon} disabled={c.disabled} onClick={() => c.run?.()}>
                  {c.label}
                </MenuItem>
              ),
            )}
          </Fragment>
        ))}
      </MenuPopup>
    </MenuRoot>
  );
}

/** How long iOS's sheet waits for a title's progress and library to load before it opens with what it has. */
const SETTLE_MS = 800;
/** The menu shown last: StrictMode mounts each menu twice, and iOS should show one sheet. */
let nativeShown = 0;

/**
 * iOS: the choices as the system's action sheet (from where the finger was, on an iPad), Add to Playlist as a
 * second one. A sheet is drawn once, so it waits for the title's state, or SETTLE_MS, first.
 */
function NativeMenu({ target, choices }: { target: Target; choices: Choices }) {
  const playlists = usePlaylistChecklist(target.item);
  const latest = useRef({ choices, playlists });
  latest.current = { choices, playlists };
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, []);
  const ready = choices.settled || waited;

  useEffect(() => {
    if (!ready || nativeShown === target.key) return;
    nativeShown = target.key;
    const anchor = { x: target.x, y: target.y, width: 0, height: 0 };
    const cancel = { id: "cancel", label: "Cancel", style: "cancel" } as const;
    void (async () => {
      const { choices } = latest.current;
      const offered = choices.groups.flat().filter((c) => !c.disabled);
      const picked = await showNativeDialog({
        kind: "sheet",
        title: target.item.name,
        message: choices.detail,
        anchor,
        actions: [...offered.map((c) => ({ id: c.id, label: c.label, style: c.destructive ? "destructive" : "default" }) as const), cancel],
      });
      const choice = offered.find((c) => c.id === picked);
      if (!choice?.playlists) return choice?.run?.();
      const list = latest.current.playlists;
      const row = await showNativeDialog({
        kind: "sheet",
        title: choice.label,
        anchor,
        actions: [
          ...list.rows.map((r) => ({ id: r.id, label: r.has ? `Remove from “${r.name}”` : `Add to “${r.name}”`, style: "default" }) as const),
          ...(list.full ? [] : [{ id: "\0new", label: "New Playlist", style: "default" } as const]),
          cancel,
        ],
      });
      if (row === "\0new") list.create();
      const r = list.rows.find((r) => r.id === row);
      if (r) list.toggle(r);
    })()
      .catch(warnFailed("card menu"))
      .finally(() => set(null));
  }, [ready, target]);
  return null;
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
