/**
 * Builds the extension (#208) for Chrome and Firefox from the same code: `bun run build` here makes
 * dist/chrome and dist/firefox, each a folder to load unpacked or to zip for its store. The two
 * differ only in how the manifest names the background script (and Firefox's own settings).
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "./package.json";

const here = import.meta.dir;
const dist = join(here, "dist");

/** The sites the button shows on, and nothing else: no "all sites" access. */
export const SITES = [
  "https://www.imdb.com/title/*",
  "https://m.imdb.com/title/*",
  "https://www.imdb.com/*/title/*",
  "https://www.themoviedb.org/movie/*",
  "https://www.themoviedb.org/tv/*",
  "https://anilist.co/anime/*",
  "https://myanimelist.net/anime/*",
  "https://trakt.tv/movies/*",
  "https://trakt.tv/shows/*",
  "https://app.trakt.tv/*",
  "https://letterboxd.com/film/*",
  // A single-page app: a video page can be reached from any of its pages without a load.
  "https://www.youtube.com/*",
  "https://m.youtube.com/*",
];

const icons = { "32": "icons/32.png", "64": "icons/64.png", "128": "icons/128.png" };

function manifest(browser: "chrome" | "firefox") {
  return {
    manifest_version: 3,
    name: "Open in Polarity",
    short_name: "Polarity",
    version: pkg.version,
    description: "Opens the film, show or anime you're looking at in Polarity, and starts a watch party for a YouTube video or a video link.",
    homepage_url: "https://getpolar.app",
    icons,
    permissions: ["contextMenus"],
    content_scripts: [{ matches: SITES, js: ["content.js"], run_at: "document_idle" }],
    background: browser === "chrome" ? { service_worker: "background.js" } : { scripts: ["background.js"] },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: { id: "open-in-polarity@getpolar.app", strict_min_version: "128.0", data_collection_permissions: { required: ["none"] } },
          },
        }
      : { minimum_chrome_version: "120" }),
  };
}

// Built only when run, so tests can import SITES.
if (import.meta.main) {
  rmSync(dist, { recursive: true, force: true });
  for (const browser of ["chrome", "firefox"] as const) {
    const out = join(dist, browser);
    mkdirSync(join(out, "icons"), { recursive: true });
    const built = await Bun.build({
      entrypoints: [join(here, "src/content.ts"), join(here, "src/background.ts")],
      outdir: out,
      format: "iife",
      target: "browser",
      minify: false,
    });
    if (!built.success) {
      for (const log of built.logs) console.error(log);
      process.exit(1);
    }
    writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest(browser), null, 2)}\n`);
    // The app's own icon.
    for (const [size, file] of Object.entries({ "32": "32x32.png", "64": "64x64.png", "128": "128x128.png" })) {
      cpSync(join(here, "../src-tauri/icons", file), join(out, "icons", `${size}.png`));
    }
    console.log(`built ${browser}: ${out}`);
  }
}
