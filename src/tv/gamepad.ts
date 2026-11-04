import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
import { type Action, getPrefs, keyEventFor, usePrefs } from "../lib/settings";
import { getPadBindings, type PadButton } from "./padBindings";
import { isTvMode, setTvMode } from "./tvMode";

/**
 * Game controllers (Xbox, PlayStation, anything with the standard mapping)
 * drive the app by turning buttons into the keys the keyboard already uses:
 * D-pad / left stick → arrows, A → Enter, B → Esc. So every screen, the player
 * and its pickers included, works with a controller without knowing about one.
 *
 * Shell-only buttons (shoulders to switch tabs, Y for search, Menu) arrive as
 * a `polar:tv-action` event instead. Button names here are Xbox's; the
 * on-screen labels follow whichever controller is in use (see `usePadFamily`).
 */
export type TvAction = "search" | "prevTab" | "nextTab" | "menu";
export const TV_ACTION_EVENT = "polar:tv-action";

export type Button = "a" | "b" | "x" | "y" | "lb" | "rb" | "view" | "menu" | "up" | "down" | "left" | "right";

/** Whose labels the controller's buttons wear. Anything unrecognised gets Xbox's (the de facto standard). */
export type PadFamily = "xbox" | "playstation" | "nintendo";

/**
 * Tell the maker from the id the browser reports, e.g. "DualSense Wireless
 * Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)" — Sony is USB
 * vendor 054c, Nintendo 057e.
 */
function familyOf(pad: Gamepad | string): PadFamily {
  const id = (typeof pad === "string" ? pad : pad.id).toLowerCase();
  if (/054c|dualsense|dualshock|playstation|^wireless controller/.test(id)) return "playstation";
  if (/057e|nintendo|pro controller|joy-con/.test(id)) return "nintendo";
  return "xbox";
}

/** Standard Gamepad mapping (w3.org/TR/gamepad/#remapping). */
const BUTTONS: Partial<Record<number, Button>> = {
  0: "a",
  1: "b",
  2: "x",
  3: "y",
  4: "lb",
  5: "rb",
  8: "view",
  9: "menu",
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};
const DIRECTIONS = new Set<Button>(["up", "down", "left", "right"]);

/** How far the stick tilts before it counts (Settings → Controller → Stick sensitivity). */
const STICK_DEADZONE = { low: 0.7, normal: 0.55, high: 0.35 } as const;

/**
 * Held directions repeat like a held key: a pause, then a steady stream that
 * speeds up after FAST_AFTER (Settings → Controller → Repeat speed).
 */
const REPEAT = {
  slow: { delay: 500, slow: 180, fast: 110 },
  normal: { delay: 380, slow: 130, fast: 70 },
  fast: { delay: 280, slow: 90, fast: 45 },
} as const;
const FAST_AFTER = 1200;

// --- Connected state ----------------------------------------------------------

let connected = false;
/** The controller last used, so mixing an Xbox and a PlayStation pad shows the one in your hands. */
let family: PadFamily = "xbox";
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
function setConnected(next: boolean, name = "") {
  if (next === connected) return;
  connected = next;
  if (next && notice?.kind === "connected" && notice.awaitingPress) {
    // The controller we said hello to is now in use.
    notice = { ...notice, awaitingPress: false };
  } else if (!native) {
    // Without native detection, the Gamepad API is all we know.
    announce(next ? "connected" : "disconnected", name || "Controller", false);
  }
  notify();
}

// --- Notices ------------------------------------------------------------------

/** "Xbox Controller connected" and friends, shown as a toast (see ControllerToast). */
export interface ControllerNotice {
  key: number;
  kind: "connected" | "disconnected";
  name: string;
  family: PadFamily;
  /** Seen by the OS, but the app can't use it until a button is pressed (a browser rule). */
  awaitingPress: boolean;
}
let notice: ControllerNotice | null = null;
let noticeKey = 0;

function announce(kind: ControllerNotice["kind"], name: string, awaitingPress: boolean) {
  notice = { key: ++noticeKey, kind, name: displayName(name), family: familyOf(name), awaitingPress };
  notify();
}

export function dismissNotice() {
  if (!notice) return;
  notice = null;
  notify();
}

export function useControllerNotice() {
  return useSyncExternalStore(subscribe, () => notice);
}

/** A readable name from what the OS or browser calls a controller. */
function displayName(raw: string) {
  const name = raw.replace(/\s*\(.*\)\s*$/, "").trim(); // "… (STANDARD GAMEPAD Vendor: …)"
  if (!name || /^xinput|^standard gamepad/i.test(name)) return "Controller";
  return name;
}

// --- Native detection ---------------------------------------------------------

/** Controllers the OS reports (src-tauri/src/controllers.rs); null if that isn't available. */
let native: { id: number; name: string }[] | null = null;

async function watchNative() {
  try {
    await listen<{ id: number; name: string }>("controller-connected", ({ payload }) => {
      native = [...(native ?? []).filter((c) => c.id !== payload.id), payload];
      setFamily(familyOf(payload.name));
      announce("connected", payload.name, !connected);
      start(); // it may be usable already
    });
    await listen<{ id: number; name: string }>("controller-disconnected", ({ payload }) => {
      native = (native ?? []).filter((c) => c.id !== payload.id);
      announce("disconnected", payload.name, false);
      start();
    });
    const list = await invoke<{ id: number; name: string }[] | null>("controllers_list");
    if (!list) return;
    native = list;
    // Already plugged in at launch: say so, since the browser won't until a button is pressed.
    if (list.length && !connected) {
      setFamily(familyOf(list[0].name));
      announce("connected", list[0].name, true);
    }
  } catch {
    native = null;
  }
}

/** Whether the OS reports a controller, even one the app can't use yet. */
export function useControllerDetected() {
  return useSyncExternalStore(subscribe, () => connected || !!native?.length);
}
function setFamily(next: PadFamily) {
  if (next === family) return;
  family = next;
  notify();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Whether a controller is connected (it shows once a button has been pressed — a browser rule). */
export function useGamepadConnected() {
  return useSyncExternalStore(subscribe, () => connected);
}

/** Which kind of controller's labels to show: the one in use, unless Settings picks one. */
export function usePadFamily() {
  const pick = usePrefs().padLabels;
  const inUse = useSyncExternalStore(subscribe, () => family);
  return pick === "auto" ? inUse : pick;
}

// --- Dispatch -----------------------------------------------------------------

const ARROW: Record<"up" | "down" | "left" | "right", string> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

function focused(): HTMLElement {
  const el = document.activeElement;
  return el instanceof HTMLElement ? el : document.body;
}

function key(name: string, target: HTMLElement = focused()) {
  return target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

/** Select: Enter on the focused control; if nothing claims it, press it. */
function activate() {
  const el = focused();
  if (el === document.body) return;
  if (key("Enter", el) && !el.matches("input:not([type=checkbox]):not([type=radio]), textarea")) el.click();
}

function act(action: Action) {
  const init = keyEventFor(action);
  if (init) focused().dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
}

const PLAYER_DIRECTIONS: Record<"left" | "right" | "up" | "down", Action> = {
  left: "seekBack",
  right: "seekForward",
  up: "volumeUp",
  down: "volumeDown",
};

const playerActive = () => !!document.querySelector('.player-layer:not([data-leaving="true"])');
const tvAction = (action: TvAction) => window.dispatchEvent(new CustomEvent(TV_ACTION_EVENT, { detail: action }));

/** The last button pressed, so Settings can light up its row as you press it. */
let lastPress: { button: Button; at: number } | null = null;
export const useLastPadPress = () => useSyncExternalStore(subscribe, () => lastPress);

/** What a button does is up to Settings → Controls & TV → Controller (padBindings.ts). */
function press(button: Button) {
  lastPress = { button, at: performance.now() };
  notify();
  const bindings = getPadBindings();
  const direction = DIRECTIONS.has(button) ? (button as keyof typeof ARROW) : null;
  const pad = direction ? null : (button as PadButton);

  // Outside TV mode the controller does one thing: Menu switches to TV mode.
  if (!isTvMode()) {
    if (pad && bindings.nav[pad] === "menu") setTvMode(true);
    return;
  }

  if (playerActive()) {
    const inPicker = !!focused().closest(".options-overlay, .next-up, .skip-button, .player-status");
    if (direction) {
      // In a picker the D-pad moves around it; otherwise it seeks and sets the volume.
      if (inPicker) return void key(ARROW[direction]);
      if ((direction === "up" || direction === "down") && !getPrefs().padPlayerVolume) return;
      return act(PLAYER_DIRECTIONS[direction]);
    }
    // In a picker, Select and Back work as they do everywhere else.
    if (inPicker && bindings.nav[pad!] === "select") return activate();
    // Player buttons press whatever key their action is bound to (Settings → Controls).
    switch (bindings.player[pad!]) {
      case "back":
        return void key("Escape");
      case "skipOrNext":
        // Skip the intro / recap while its button is up; otherwise the next episode.
        return act(
          !document.querySelector(".next-up") && document.querySelector('.skip-button[data-visible="true"]') ? "skip" : "nextEpisode",
        );
      case "none":
        return;
      default:
        return act(bindings.player[pad!] as Action);
    }
  }

  if (direction) return void key(ARROW[direction]);
  switch (bindings.nav[pad!]) {
    case "select":
      return activate();
    case "back":
      return void key("Escape");
    case "options":
      // Options for what's focused (a title's menu), as the keyboard's Menu key.
      return void key("ContextMenu");
    case "search":
      return tvAction("search");
    case "prevTab":
      return tvAction("prevTab");
    case "nextTab":
      return tvAction("nextTab");
    case "menu":
      return tvAction("menu");
  }
}

// --- Polling ------------------------------------------------------------------

const held = new Map<Button, { since: number; next: number }>();
let frame = 0;

function pressedButtons(): Set<Button> {
  const { padStick, padStickSensitivity } = getPrefs();
  const deadzone = STICK_DEADZONE[padStickSensitivity] ?? STICK_DEADZONE.normal;
  const down = new Set<Button>();
  for (const pad of navigator.getGamepads?.() ?? []) {
    if (!pad?.connected) continue;
    const before = down.size;
    pad.buttons.forEach((b, i) => {
      const name = BUTTONS[i];
      if (name && b.pressed) down.add(name);
    });
    const [x = 0, y = 0] = pad.axes;
    if (padStick && Math.max(Math.abs(x), Math.abs(y)) > deadzone) {
      if (Math.abs(x) > Math.abs(y)) down.add(x < 0 ? "left" : "right");
      else down.add(y < 0 ? "up" : "down");
    }
    if (down.size > before) setFamily(familyOf(pad));
  }
  return down;
}

function poll(now: number) {
  frame = 0;
  const pads = [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p?.connected);
  if (pads.length && !connected) setFamily(familyOf(pads[0]));
  setConnected(pads.length > 0, pads[0]?.id);
  if (!pads.length) {
    held.clear();
    return;
  }
  // Only the focused window listens; the controller may be driving another app.
  if (document.hasFocus()) {
    const down = pressedButtons();
    const repeat = REPEAT[getPrefs().padRepeat] ?? REPEAT.normal;
    for (const b of down) {
      const h = held.get(b);
      if (!h) {
        held.set(b, { since: now, next: now + repeat.delay });
        press(b);
      } else if (DIRECTIONS.has(b) && now >= h.next) {
        h.next = now + (now - h.since > FAST_AFTER ? repeat.fast : repeat.slow);
        press(b);
      }
    }
    for (const b of [...held.keys()]) if (!down.has(b)) held.delete(b);
  } else {
    held.clear();
  }
  frame = requestAnimationFrame(poll);
}

function start() {
  if (!frame) frame = requestAnimationFrame(poll);
}

/** Start listening for controllers. Polls only while one is connected. */
export function installGamepad() {
  if (!("getGamepads" in navigator)) return;
  window.addEventListener("gamepadconnected", start);
  window.addEventListener("gamepaddisconnected", start); // poll once more to update `connected`
  // Coming back to the window: a controller may have woken while we were away.
  window.addEventListener("focus", start);
  start();
  void watchNative();
}
