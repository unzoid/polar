import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { torrentLimits } from "../src/lib/playback/torrent";
import { SETTINGS } from "../src/lib/settings/schema";

/**
 * Torrent playback's wording (#137, AGENTS.md rule 4): everything the user reads about it describes a
 * player for torrent streams from their own add-ons, never a way to get content. A new torrent string
 * goes in one of the places below, so this sees it.
 */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const torrentSettings = SETTINGS.filter((s) => s.id.startsWith("torrent")).flatMap((s) => [s.title, s.caption ?? ""]);
const sourcesPage = read("src/screens/settings/SourcesPage.tsx");
const torrentCard = sourcesPage.slice(sourcesPage.indexOf('title="Torrent Sources"'));
const readmeLines = read("README.md")
  .split("\n")
  .filter((l) => /torrent/i.test(l));

const TEXTS: Record<string, string> = {
  settings: torrentSettings.join("\n"),
  "Torrent Sources card": torrentCard,
  notice: read("src/components/player/TorrentNotice.tsx"),
  "loading screen lines": read("src/lib/playback/torrent.ts"),
  "engine messages": read("src-tauri/src/torrent.rs") + read("crates/torrent/src/engine.rs"),
  README: readmeLines.join("\n"),
};

/** Promotional wording: content for free, new releases, no subscription, piracy and release-scene terms. */
const PROMOTIONAL = [
  /\bfree\b/i,
  /\bnew releases?\b/i,
  /\bsubscriptions?\b/i,
  /\bwithout paying\b/i,
  /\bunlimited (movies|films|shows|series|episodes|content|streaming)\b/i,
  /\b(watch|stream|download|get)\w* (any|every)(thing| movie| film| show)/i,
  /\bpira(cy|ted|te|tes)\b/i,
  /\bwarez\b/i,
  /\bcracked\b/i,
  /\b(scene|release)[ -]?(groups?|releases?)\b/i,
  /\b(cam|telesync|screener)\b/i,
];

test("torrent strings use no promotional wording", () => {
  for (const [where, text] of Object.entries(TEXTS)) {
    for (const p of PROMOTIONAL) expect({ where, match: text.match(p)?.[0] ?? null }).toEqual({ where, match: null });
  }
});

test("the notice and README say the torrents come from the user's add-ons", () => {
  expect(TEXTS.notice).toContain("from your add-on");
  expect(TEXTS.notice).toContain("You're responsible for what you play");
  expect(readmeLines.length).toBeGreaterThan(0);
  for (const l of readmeLines) expect(l).toMatch(/your (own )?add-ons/);
});

test("the check catches promotional wording", () => {
  const caught = (s: string) => PROMOTIONAL.some((p) => p.test(s));
  expect(caught("Watch new releases")).toBe(true);
  expect(caught("Free movies, no subscription needed")).toBe(true);
  expect(caught("Download anything")).toBe(true);
  expect(caught("Plays torrent streams from your add-ons")).toBe(false);
});

/** prefs.ts reads localStorage once, as it loads: each case loads a fresh copy over its own storage. */
async function prefsWith(stored: Record<string, unknown> | undefined, tag: string) {
  const mem = new Map(stored ? [["polar.prefs", JSON.stringify(stored)]] : []);
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  return (await import(`../src/lib/settings/prefs?torrent-${tag}`)) as typeof import("../src/lib/settings/prefs");
}

test("by default upload is capped, download isn't, nothing is shared after playback, and the notice is due", async () => {
  const { getPrefs } = await prefsWith(undefined, "new");
  const l = torrentLimits(getPrefs());
  expect(l.uploadMbps).toBeGreaterThan(0);
  expect(l.uploadMbps).toBeLessThanOrEqual(8);
  expect(l.downloadMbps).toBe(0);
  expect(l.keepSharing).toBe(false);
  expect(getPrefs().torrentNotice).toBe(true);
});

test("a speed limit set before #137 keeps upload at most that low", async () => {
  const { TORRENT_UPLOAD_MBPS } = await prefsWith(undefined, "const");
  const upload = async (stored: Record<string, unknown>, tag: string) => (await prefsWith(stored, tag)).getPrefs().torrentUploadMbps;
  expect(await upload({ torrentSpeedMbps: 2 }, "low")).toBe(2);
  expect(await upload({ torrentSpeedMbps: 50 }, "high")).toBe(TORRENT_UPLOAD_MBPS);
  expect(await upload({ torrentSpeedMbps: 0 }, "off")).toBe(TORRENT_UPLOAD_MBPS);
  expect(await upload({ torrentSpeedMbps: 2, torrentUploadMbps: 10 }, "chosen")).toBe(10);
  expect(await upload({ torrentSpeedMbps: 2, torrentUploadMbps: 0 }, "unlimited")).toBe(0);
});
