import { useSyncExternalStore } from "react";
import { settingsChanged } from "./settingsChanges";
import { isRecord, strings, storedJson } from "./parse";
import { isMac, MOD } from "./platform";

/**
 * Keyboard shortcuts, rebindable in Settings → Controls. A binding is a combo
 * string like "k", "ArrowLeft", "Space" or "Ctrl+Shift+T"; each action has up
 * to two. Saved locally and synced with the profile (account/settingsSync.ts).
 *
 * A controller drives the same actions: gamepad.ts presses an action's first
 * key, so rebinding never strands a controller button.
 */
export type Action =
  | "playPause"
  | "seekBack"
  | "seekForward"
  | "volumeUp"
  | "volumeDown"
  | "mute"
  | "fullscreen"
  | "skip"
  | "nextEpisode"
  | "tracks"
  | "episodes"
  | "sources"
  | "speed"
  | "toggleTv"
  | "search";

export type ActionGroup = "player" | "app";

/** `when` says where a shortcut works, if not everywhere its group's does. */
export const ACTIONS: { id: Action; label: string; group: ActionGroup; when?: string }[] = [
  { id: "playPause", label: "Play / pause", group: "player" },
  { id: "seekBack", label: "Skip back", group: "player" },
  { id: "seekForward", label: "Skip forward", group: "player" },
  { id: "volumeUp", label: "Volume up", group: "player" },
  { id: "volumeDown", label: "Volume down", group: "player" },
  { id: "mute", label: "Mute", group: "player" },
  { id: "fullscreen", label: "Fullscreen", group: "player" },
  { id: "skip", label: "Skip intro / recap", group: "player" },
  { id: "nextEpisode", label: "Next episode", group: "player" },
  { id: "tracks", label: "Subtitles & audio", group: "player" },
  { id: "episodes", label: "Episodes", group: "player" },
  { id: "sources", label: "Sources", group: "player" },
  { id: "speed", label: "Playback speed", group: "player" },
  { id: "toggleTv", label: "Switch TV / desktop mode", group: "app", when: "Anywhere, even while watching" },
  { id: "search", label: "Search", group: "app", when: "While browsing" },
];

export const GROUPS: { id: ActionGroup; label: string; when: string }[] = [
  { id: "player", label: "Player", when: "While watching" },
  { id: "app", label: "App", when: "While browsing" },
];

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  playPause: ["Space", "k"],
  seekBack: ["ArrowLeft", "j"],
  seekForward: ["ArrowRight", "l"],
  volumeUp: ["ArrowUp"],
  volumeDown: ["ArrowDown"],
  mute: ["m"],
  fullscreen: ["f"],
  skip: ["s"],
  nextEpisode: ["n"],
  tracks: ["c"],
  episodes: ["e"],
  sources: ["o"],
  speed: ["r"],
  toggleTv: ["F10"],
  // Letters are stored lower-case (see comboOf); they're shown upper-case.
  search: ["/", `${MOD}+k`],
};

/** Keys that keep their meaning everywhere and can't be bound: Back, and typing into fields. */
export const RESERVED = new Set(["Escape", "Tab", "Enter", "Backspace"]);
export const MAX_BINDINGS = 2;

const STORAGE = "polar.keybinds";

const load = (): Record<Action, string[]> => ({ ...DEFAULT_BINDINGS, ...readBindings(storedJson(localStorage, STORAGE)) });

/** Stored or synced overrides: known actions only, each a list of combos (critique M9). */
export function readBindings(v: unknown): Partial<Record<Action, string[]>> {
  if (!isRecord(v)) return {};
  return Object.fromEntries(
    Object.entries(v)
      .filter(([a, c]) => a in DEFAULT_BINDINGS && Array.isArray(c))
      .map(([a, c]) => [a, strings(c).slice(0, MAX_BINDINGS)]),
  );
}

let bindings = load();
const listeners = new Set<() => void>();

/** Only what differs from the defaults is stored (and synced), so new defaults reach everyone else. */
export const bindingOverrides = (): Partial<Record<Action, string[]>> =>
  Object.fromEntries(
    Object.entries(bindings).filter(([a, combos]) => combos.join() !== DEFAULT_BINDINGS[a as Action].join()),
  );

function commit(next: Record<Action, string[]>, { quiet = false } = {}) {
  bindings = next;
  localStorage.setItem(STORAGE, JSON.stringify(bindingOverrides()));
  listeners.forEach((l) => l());
  if (!quiet) settingsChanged();
}

/** Replace every binding with the defaults plus `overrides` (a synced profile's). */
export function applyBindingOverrides(overrides: unknown) {
  commit({ ...DEFAULT_BINDINGS, ...readBindings(overrides) }, { quiet: true });
}

export function useBindings() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => bindings,
  );
}

/**
 * Bind `combo` to `action` in slot `index` (append if past the end). A combo
 * belongs to one action at a time; it's taken off any other action, which is
 * returned so the UI can say so.
 */
export function bind(action: Action, index: number, combo: string): Action | null {
  let stolenFrom: Action | null = null;
  const next = { ...bindings };
  for (const a of Object.keys(next) as Action[]) {
    if (a !== action && next[a].includes(combo)) {
      next[a] = next[a].filter((c) => c !== combo);
      stolenFrom = a;
    }
  }
  const own = next[action].filter((c) => c !== combo);
  own.splice(Math.min(index, own.length), index < own.length ? 1 : 0, combo);
  next[action] = own.slice(0, MAX_BINDINGS);
  commit(next);
  return stolenFrom;
}

export function unbind(action: Action, index: number) {
  commit({ ...bindings, [action]: bindings[action].filter((_, i) => i !== index) });
}

export function resetBindings(action?: Action) {
  commit(action ? { ...bindings, [action]: DEFAULT_BINDINGS[action] } : { ...DEFAULT_BINDINGS });
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock"]);

/**
 * The combo a key press makes, or null for a lone modifier. Shift only counts
 * with named keys: for characters it's already in the key ("?" not "Shift+/").
 */
export function comboOf(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && key.length > 1 && "Shift", e.metaKey && "Meta"];
  return [...mods.filter(Boolean), key].join("+");
}

/** The action a key press triggers, among `group`'s (all groups if omitted). */
export function actionFor(e: KeyboardEvent, group?: ActionGroup): Action | null {
  const combo = comboOf(e);
  if (!combo) return null;
  for (const a of ACTIONS) {
    if ((!group || a.group === group) && bindings[a.id].includes(combo)) return a.id;
  }
  return null;
}

/** A synthetic key press for `action`'s first binding (how the controller triggers it). */
export function keyEventFor(action: Action): KeyboardEventInit | null {
  const combo = bindings[action][0];
  if (!combo) return null;
  const parts = combo.split("+");
  const key = parts.pop()!;
  return {
    key: key === "Space" ? " " : key,
    ctrlKey: parts.includes("Ctrl"),
    altKey: parts.includes("Alt"),
    shiftKey: parts.includes("Shift"),
    metaKey: parts.includes("Meta"),
  };
}

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Space: "Space",
  " ": "Space",
  ...(isMac ? { Meta: "⌘", Alt: "⌥", Shift: "⇧", Ctrl: "⌃" } : { Meta: "Win" }),
};

/** "Ctrl+Shift+T" → ["Ctrl", "Shift", "T"], keys as people read them (⌘ ⌥ ⇧ on a Mac). */
export function comboLabel(combo: string): string[] {
  return combo.split("+").map((k) => KEY_LABELS[k] ?? (k.length === 1 ? k.toUpperCase() : k));
}

/** The first shortcut for `action`, written out ("F10"), for menus and tooltips. */
export const shortcutText = (action: Action) => {
  const combo = bindings[action][0];
  return combo ? comboLabel(combo).join("+") : null;
};

/** A tooltip with its shortcut: "Mute (M)". */
export const withShortcut = (label: string, action: Action) => {
  const s = shortcutText(action);
  return s ? `${label} (${s})` : label;
};
