import { useSyncExternalStore } from "react";
import { appWindow, inShell } from "../lib/platform";

/**
 * TV mode: the whole app goes fullscreen with a 10-foot interface driven by
 * arrow keys, a remote or a game controller. Remembered across launches, like
 * Big Picture's "start in Big Picture" — leave it from the TV menu.
 */
const KEY = "polar.tvMode";
let on = localStorage.getItem(KEY) === "1";
const listeners = new Set<() => void>();

function apply() {
  // Root attribute: TV type scale and cursor rules reach portalled UI too.
  if (on) document.documentElement.dataset.tv = "true";
  else delete document.documentElement.dataset.tv;
}
apply();
if (on && inShell) void appWindow.setFullscreen(true);

/**
 * Something inside the page going fullscreen and back takes the window out of
 * fullscreen with it. TV mode is always fullscreen, so put it back.
 */
if (inShell) {
  const reassert = async () => {
    if (!on) return;
    if ((await appWindow.isMinimized()) || (await appWindow.isFullscreen())) return;
    if (on) await appWindow.setFullscreen(true);
  };
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) return;
    // The window settles a moment after the element leaves fullscreen.
    for (const ms of [60, 300]) window.setTimeout(() => void reassert(), ms);
  });
}

export function setTvMode(next: boolean) {
  if (next === on) return;
  on = next;
  localStorage.setItem(KEY, next ? "1" : "0");
  apply();
  if (inShell) void appWindow.setFullscreen(next);
  listeners.forEach((l) => l());
}

export const isTvMode = () => on;

export function useTvMode() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on,
  );
}
