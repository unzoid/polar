import { expect, test } from "bun:test";
import { VIDEO_PATTERNS } from "../src/ids";

// "Watch together in Polarity" in the context menu (#208), with a stand-in for the browser's API.

type Click = { menuItemId: string; linkUrl?: string; pageUrl?: string; linkText?: string };
const menus: { id: string; contexts: string[]; targetUrlPatterns?: string[]; documentUrlPatterns?: string[] }[] = [];
const opened: { url: string; index?: number }[] = [];
const on: Record<string, (...a: never[]) => void> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { onInstalled: { addListener: (fn: () => void) => (on.installed = fn) }, onStartup: { addListener: (fn: () => void) => (on.startup = fn) } },
  contextMenus: {
    removeAll: (done: () => void) => ((menus.length = 0), done()),
    create: (m: (typeof menus)[number]) => menus.push(m),
    onClicked: { addListener: (fn: (info: Click, tab?: { index: number; title?: string }) => void) => (on.clicked = fn) },
  },
  tabs: { create: (t: { url: string; index?: number }) => opened.push(t) },
};
await import("../src/background");
const click = on.clicked as unknown as (info: Click, tab?: { index: number; title?: string }) => void;

test("the menu shows only on links to video files and streams, and on a tab that is one", () => {
  on.installed();
  on.startup();
  expect(menus.map((m) => [m.id, m.contexts])).toEqual([
    ["together-link", ["link"]],
    ["together-page", ["page", "video"]],
  ]);
  expect(menus[0].targetUrlPatterns).toEqual(VIDEO_PATTERNS);
  expect(menus[1].documentUrlPatterns).toEqual(VIDEO_PATTERNS);
});

test("choosing it opens the website's /party page next to the tab, with the link in the fragment", () => {
  click({ menuItemId: "together-link", linkUrl: "https://media.example.com/film.mp4", linkText: "An open film" }, { index: 3, title: "Some page" });
  const tab = opened.pop()!;
  expect(tab.index).toBe(4);
  const u = new URL(tab.url);
  expect(u.origin + u.pathname + u.search).toBe("https://getpolar.app/party/");
  expect(Object.fromEntries(new URLSearchParams(u.hash.slice(1)))).toEqual({ u: "https://media.example.com/film.mp4", t: "0", n: "An open film" });

  click({ menuItemId: "together-page", pageUrl: "https://media.example.com/live/index.m3u8" }, { index: 0, title: "index.m3u8" });
  expect(new URLSearchParams(new URL(opened.pop()!.url).hash.slice(1)).get("u")).toBe("https://media.example.com/live/index.m3u8");
});

test("anything that isn't a video link opens nothing, whatever the menu was shown on", () => {
  click({ menuItemId: "together-link", linkUrl: "https://media.example.com/page.html" });
  click({ menuItemId: "together-link", linkUrl: "https://user:pass@media.example.com/film.mp4" });
  click({ menuItemId: "together-page", pageUrl: "file:///films/film.mp4" });
  click({ menuItemId: "something-else", linkUrl: "https://media.example.com/film.mp4" });
  expect(opened).toEqual([]);
});
