import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, Close, Info, Minus, PlaylistIcon, Plus, Reset, Watched } from "../components/icons";
import { episodeCode } from "../lib/format";
import { useRouter } from "../lib/router";
import { useTitleActions } from "../lib/titleActions";
import type { MetaPreview, Progress } from "../lib/types";
import { useBack, useFocusTrap } from "./shell";
import { playSound } from "./sounds";
import { NamePanel, PlaylistsPanel } from "./TvDetail";

/**
 * A title's options, the way a TV does them: hold on a card and press X /
 * Square (or right-click, or the Menu key), and a short list opens beside it
 * — details, watched, library, playlists. Back closes it and leaves
 * you on the card.
 */

interface Target {
  item: MetaPreview;
  /** The progress the card stands for (Continue Watching): offers that episode on its own. */
  entry?: Progress;
  anchor: HTMLElement;
  key: number;
}

let current: Target | null = null;
let opened = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * Windows follows a Menu key press with a contextmenu event when the key comes
 * up. Closing the menu with that key would reopen it on the card underneath.
 */
let ignoreUntil = 0;

export function openCardMenu(target: Omit<Target, "key">) {
  if (current || performance.now() < ignoreUntil) return;
  // The card stays lifted while the menu is up, so you can see what it's for.
  target.anchor.dataset.menuOpen = "true";
  current = { ...target, key: ++opened };
  playSound("select");
  notify();
}

/** Close, and (unless you're leaving the page) put focus back on the card. */
function closeCardMenu({ restore = true } = {}) {
  if (!current) return;
  const { anchor } = current;
  delete anchor.dataset.menuOpen;
  current = null;
  notify();
  if (restore) {
    requestAnimationFrame(() => {
      if (anchor.isConnected && !anchor.closest("[inert]")) anchor.focus({ preventScroll: true });
    });
  }
}

export const useCardMenuOpen = () => useSyncExternalStore(subscribe, () => !!current);

/** Whether a key press asks for a card's options: the Menu key, Shift+F10, or a controller's X / Square. */
export const isMenuKey = (e: { key: string; shiftKey: boolean }) => e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");

export function TvCardMenuHost() {
  const target = useSyncExternalStore(subscribe, () => current);
  if (!target) return null;
  return <Layers key={target.key} target={target} />;
}

type Layer = { kind: "menu" } | { kind: "playlists" } | { kind: "name"; playlistId?: string };

function Layers({ target }: { target: Target }) {
  // Picking a playlist replaces the menu: Back from there goes to the card.
  const [layers, setLayers] = useState<Layer[]>([{ kind: "menu" }]);
  const pop = () => (layers.length > 1 ? setLayers((ls) => ls.slice(0, -1)) : closeCardMenu());
  useBack(true, pop);
  const top = layers[layers.length - 1];

  return (
    <div
      className="tv-card-menu-layer"
      data-dim={top.kind === "menu" || undefined}
      onClick={(e) => e.target === e.currentTarget && closeCardMenu()}
      onContextMenu={(e) => {
        e.preventDefault();
        if (e.target === e.currentTarget) closeCardMenu();
      }}
    >
      {layers.map((layer, i) => {
        const isTop = i === layers.length - 1;
        switch (layer.kind) {
          case "menu":
            return <CardMenu key={i} target={target} onLayer={(l) => setLayers([l])} />;
          case "playlists":
            return (
              <PlaylistsPanel
                key={i}
                item={target.item}
                onRename={(playlistId) => setLayers((ls) => [...ls, { kind: "name", playlistId }])}
                onNew={() => setLayers((ls) => [...ls, { kind: "name" }])}
              />
            );
          case "name":
            return <NamePanel key={i} item={target.item} playlistId={layer.playlistId} active={isTop} onDone={pop} />;
        }
      })}
    </div>
  );
}
interface Item {
  label: string;
  icon: ReactNode;
  onPick: () => void;
  disabled?: boolean;
}

const EDGE = 24; // keep clear of the screen's edges
const GAP = 28; // between the lifted card and the menu

function CardMenu({ target, onLayer }: { target: Target; onLayer: (l: Layer) => void }) {
  const { item, entry, anchor } = target;
  const { navigate } = useRouter();
  const a = useTitleActions(item, entry);

  const act = (fn: () => void) => () => {
    fn();
    closeCardMenu();
  };

  const groups: Item[][] = [
    [
      {
        label: a.isSeries ? "Go to Show" : "Go to Movie",
        icon: <Info size={24} />,
        onPick: () => {
          closeCardMenu({ restore: false });
          navigate({ name: "detail", type: item.type, id: item.id, preview: item });
        },
      },
    ],
    [
      ...(a.episodeUnwatched
        ? [{ label: `Mark ${a.episodeLabel} as Watched`, icon: <Watched size={24} />, onPick: act(a.markEpisodeWatched) }]
        : []),
      {
        label: `Mark ${a.isSeries ? "Show " : ""}as ${a.allWatched ? "Unwatched" : "Watched"}`,
        icon: a.allWatched ? <Reset size={24} /> : <Watched size={24} />,
        disabled: !a.canToggleWatched,
        onPick: act(a.toggleWatched),
      },
      ...(a.entryInProgress
        ? [{ label: "Remove from Continue Watching", icon: <Close size={24} />, onPick: act(a.resetEntry) }]
        : []),
      ...(a.hasProgress && !a.allWatched
        ? [{ label: "Reset Progress", icon: <Reset size={24} />, onPick: act(a.resetAll) }]
        : []),
    ],
    [
      {
        label: a.inLibrary ? "Remove from Library" : "Add to Library",
        icon: a.inLibrary ? <Minus size={24} /> : <Plus size={24} />,
        onPick: act(a.toggleLibrary),
      },
      {
        label: a.inPlaylist ? "Edit Playlists" : "Add to Playlist",
        icon: a.inPlaylist ? <Check size={24} /> : <PlaylistIcon size={24} />,
        onPick: () => onLayer({ kind: "playlists" }),
      },
    ],
  ];

  // Beside the card: to its right if there's room, otherwise its left; level with its top.
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  const [place, setPlace] = useState<{ left: number; top: number; side: "left" | "right" } | null>(null);
  useLayoutEffect(() => {
    const menu = ref.current;
    const layer = menu?.parentElement;
    if (!menu || !layer) return;
    const measure = () => {
      const box = layer.getBoundingClientRect();
      const card = anchor.getBoundingClientRect();
      const w = menu.offsetWidth;
      const h = menu.offsetHeight;
      const right = card.right - box.left + GAP;
      const side = right + w <= box.width - EDGE ? "right" : "left";
      const left = side === "right" ? right : card.left - box.left - GAP - w;
      setPlace({
        left: Math.max(EDGE, Math.min(left, box.width - w - EDGE)),
        top: Math.max(EDGE, Math.min(card.top - box.top, box.height - h - EDGE)),
        side,
      });
    };
    measure();
    // Rows come and go as the title's details arrive.
    const ro = new ResizeObserver(measure);
    ro.observe(menu);
    return () => ro.disconnect();
  }, [anchor]);

  const shown = groups.filter((g) => g.length);
  let first = true;

  return (
    <div
      ref={ref}
      className="tv-card-menu"
      data-nav-scope
      data-side={place?.side}
      role="menu"
      aria-label={`${item.name} options`}
      style={place ? { left: place.left, top: place.top } : { visibility: "hidden" }}
      onKeyDown={(e) => {
        // The same button closes it again.
        if (!isMenuKey(e)) return;
        e.preventDefault();
        // A real key (not the controller's) has a contextmenu event still to come.
        if (e.isTrusted) ignoreUntil = performance.now() + 800;
        playSound("back");
        closeCardMenu();
      }}
    >
      <div className="tv-card-menu-head">
        <strong>{item.name}</strong>
        {entry?.season != null && <span>{episodeCode(entry.season, entry.episode)}{entry.episodeTitle ? ` · ${entry.episodeTitle}` : ""}</span>}
      </div>
      {shown.map((group, g) => (
        <div key={g} className="tv-card-menu-group">
          {group.map((it) => {
            const isDefault = first && !it.disabled;
            if (isDefault) first = false;
            return (
              <button
                key={it.label}
                className="tv-card-menu-item"
                role="menuitem"
                disabled={it.disabled}
                data-nav-default={isDefault || undefined}
                onClick={it.onPick}
              >
                <span>{it.label}</span>
                {it.icon}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
