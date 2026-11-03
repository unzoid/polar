import { useSyncExternalStore } from "react";

/**
 * What each controller button does, rebindable in Settings → Controls & TV →
 * Controller. Two layouts: one for moving around the app, one for the player.
 * The D-pad and left stick always move (and seek / change volume in the
 * player); everything else is up to you.
 *
 * Buttons trade places rather than double up: give B "Select" and A takes
 * B's old job. So Select and Back can never go missing, and you can't lock
 * yourself out with a controller in your hands.
 *
 * Kept on this machine, like its controllers.
 */
export type PadButton = "a" | "b" | "x" | "y" | "lb" | "rb" | "view" | "menu";
export const PAD_BUTTONS: PadButton[] = ["a", "b", "x", "y", "lb", "rb", "menu", "view"];

export type NavAction = "select" | "back" | "options" | "search" | "prevTab" | "nextTab" | "menu" | "none";
export type PlayerPadAction =
  | "playPause"
  | "back"
  | "tracks"
  | "episodes"
  | "sources"
  | "speed"
  | "skipOrNext"
  | "skip"
  | "nextEpisode"
  | "mute"
  | "fullscreen"
  | "none";

export const NAV_ACTIONS: { id: NavAction; label: string }[] = [
  { id: "select", label: "Select" },
  { id: "back", label: "Back" },
  { id: "options", label: "Title options" },
  { id: "search", label: "Search" },
  { id: "prevTab", label: "Previous section" },
  { id: "nextTab", label: "Next section" },
  { id: "menu", label: "Menu" },
  { id: "none", label: "Nothing" },
];

export const PLAYER_ACTIONS: { id: PlayerPadAction; label: string }[] = [
  { id: "playPause", label: "Play / pause" },
  { id: "back", label: "Back" },
  { id: "tracks", label: "Subtitles & audio" },
  { id: "episodes", label: "Episodes" },
  { id: "sources", label: "Sources" },
  { id: "speed", label: "Playback speed" },
  { id: "skipOrNext", label: "Skip intro, or next episode" },
  { id: "skip", label: "Skip intro / recap" },
  { id: "nextEpisode", label: "Next episode" },
  { id: "mute", label: "Mute" },
  { id: "fullscreen", label: "Fullscreen" },
  { id: "none", label: "Nothing" },
];

/** Jobs a layout can't lose: without them a controller can't get around (or out). */
export const REQUIRED = { nav: new Set<NavAction>(["select", "back"]), player: new Set<PlayerPadAction>(["back"]) };

export interface PadBindings {
  nav: Record<PadButton, NavAction>;
  player: Record<PadButton, PlayerPadAction>;
}
export type Layout = keyof PadBindings;

export const DEFAULT_PAD_BINDINGS: PadBindings = {
  nav: { a: "select", b: "back", x: "options", y: "search", lb: "prevTab", rb: "nextTab", view: "menu", menu: "menu" },
  player: {
    a: "playPause",
    b: "back",
    x: "tracks",
    y: "episodes",
    lb: "sources",
    rb: "skipOrNext",
    view: "speed",
    menu: "playPause",
  },
};

const STORAGE = "polar.padBindings";
const NAV_IDS = new Set(NAV_ACTIONS.map((a) => a.id));
const PLAYER_IDS = new Set(PLAYER_ACTIONS.map((a) => a.id));

function load(): PadBindings {
  const out: PadBindings = { nav: { ...DEFAULT_PAD_BINDINGS.nav }, player: { ...DEFAULT_PAD_BINDINGS.player } };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? "{}") as Partial<Record<Layout, Record<string, string>>>;
    for (const b of PAD_BUTTONS) {
      const n = saved.nav?.[b];
      if (n && NAV_IDS.has(n as NavAction)) out.nav[b] = n as NavAction;
      const p = saved.player?.[b];
      if (p && PLAYER_IDS.has(p as PlayerPadAction)) out.player[b] = p as PlayerPadAction;
    }
  } catch {
    /* defaults */
  }
  // A hand-edited or stale file mustn't strand anyone.
  for (const layout of ["nav", "player"] as const) {
    const values = Object.values(out[layout]) as string[];
    if ([...REQUIRED[layout]].some((r) => !values.includes(r))) out[layout] = { ...DEFAULT_PAD_BINDINGS[layout] } as never;
  }
  return out;
}

let bindings = load();
const listeners = new Set<() => void>();

function commit(next: PadBindings) {
  bindings = next;
  localStorage.setItem(STORAGE, JSON.stringify(next));
  listeners.forEach((l) => l());
}

export const getPadBindings = () => bindings;

export function usePadBindings() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => bindings,
  );
}

/** Who else has `action` (not counting `button`). */
const holder = (map: Record<PadButton, string>, button: PadButton, action: string) =>
  action === "none" ? undefined : PAD_BUTTONS.find((b) => b !== button && map[b] === action);

/**
 * Whether `button` can take `action`: always, unless that would leave a
 * required job (Select, Back) with no button. A button that's the only one
 * doing a required job can only trade it for another button's job.
 */
export function canBind<L extends Layout>(b: PadBindings, layout: L, button: PadButton, action: PadBindings[L][PadButton]) {
  const map = b[layout] as Record<PadButton, string>;
  const old = map[button];
  if (old === action || !(REQUIRED[layout] as Set<string>).has(old)) return true;
  return !!holder(map, button, old) || !!holder(map, button, action);
}

/**
 * Give `button` a job. If another button had it, the two trade places.
 * Returns the button that took the old job, if any.
 */
export function setPadBinding<L extends Layout>(layout: L, button: PadButton, action: PadBindings[L][PadButton]): PadButton | null {
  if (!canBind(bindings, layout, button, action)) return null;
  const map = { ...bindings[layout] } as Record<PadButton, string>;
  const old = map[button];
  if (old === action) return null;
  const other = holder(map, button, action);
  map[button] = action;
  if (other) map[other] = old;
  commit({ ...bindings, [layout]: map });
  return other ?? null;
}

export const resetPadBindings = (layout?: Layout) =>
  commit(
    layout
      ? { ...bindings, [layout]: { ...DEFAULT_PAD_BINDINGS[layout] } }
      : { nav: { ...DEFAULT_PAD_BINDINGS.nav }, player: { ...DEFAULT_PAD_BINDINGS.player } },
  );

export const padBindingsCustomized = (b: PadBindings, layout: Layout) =>
  PAD_BUTTONS.some((k) => b[layout][k] !== DEFAULT_PAD_BINDINGS[layout][k]);

/** The first button bound to any of `actions` (in that order), for on-screen hints. */
export function buttonFor<L extends Layout>(b: PadBindings, layout: L, ...actions: PadBindings[L][PadButton][]): PadButton | undefined {
  for (const a of actions) {
    const hit = PAD_BUTTONS.find((k) => b[layout][k] === a);
    if (hit) return hit;
  }
  return undefined;
}
