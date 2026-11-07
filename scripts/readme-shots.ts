#!/usr/bin/env bun
/**
 * The README's screenshots of the home screen and TV mode, made from the
 * Blender Foundation's open films only (CC BY 3.0; docs/screenshots.md):
 *
 *   bun scripts/readme-shots.ts --sintel Sintel.2010.1080p.mkv \
 *     --tears-of-steel tears_of_steel_720p.mov --big-buck-bunny big_buck_bunny_720p_h264.mov
 *
 * It takes a frame of each film for its backdrop and one for its poster, opens
 * the fake shell (`fake.html?films=1`, where the films lead the movies and
 * Continue Watching and every other title is made up) and saves
 * readme-images/home.webp and readme-images/tvmode.webp. The browser has to
 * decode H.264: Google Chrome (the default), or another Chromium build given
 * with POLAR_E2E_CHROMIUM=<path>, as for the browser tests.
 *
 * The smaller pictures in the README's feature table (a show's page, the
 * Library, a watch party, Settings) show made-up titles only and need no film:
 *
 *   bun scripts/readme-shots.ts --only show,library,party,settings
 */
import { createServer as httpServer } from "node:http";
import { createReadStream, realpathSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { createServer } from "vite";
import { serveMedia } from "../e2e/media";

/** Seconds into each film for its backdrop, and for its poster with the poster's horizontal centre (0 to 1). */
const FRAMES: Record<string, { backdrop: number; poster: [number, number] }> = {
  sintel: { backdrop: 270, poster: [300, 0.44] },
  "tears-of-steel": { backdrop: 40, poster: [200, 0.3] },
  "big-buck-bunny": { backdrop: 120, poster: [240, 0.4] },
};

const args = process.argv.slice(2);
const SHOTS = ["home", "tvmode", "show", "library", "party", "settings"];
const onlyAt = args.indexOf("--only");
const only = onlyAt < 0 ? SHOTS : (args[onlyAt + 1] ?? "").split(",");
if (only.some((name) => !SHOTS.includes(name))) {
  console.error(`--only takes some of ${SHOTS.join(",")}.`);
  process.exit(1);
}
const needFilms = only.includes("home") || only.includes("tvmode");
const files: Record<string, string> = {};
for (const key of needFilms ? Object.keys(FRAMES) : []) {
  const at = args.indexOf(`--${key}`);
  if (at < 0 || !args[at + 1]) {
    console.error(`Missing --${key} <file>. Usage: see the top of scripts/readme-shots.ts.`);
    process.exit(1);
  }
  files[key] = resolve(args[at + 1]);
}

const root = resolve(import.meta.dir, "..");
const pictures = new Map<string, Buffer>();

// The films, for the browser's <video>, with the byte ranges seeking needs.
const films = httpServer((req, res) => {
  const file = files[decodeURIComponent(req.url?.slice(1) ?? "")];
  if (!file) return void res.writeHead(404).end();
  const size = statSync(file).size;
  const type = file.endsWith(".mkv") ? "video/x-matroska" : "video/mp4";
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : size - 1;
  res.writeHead(range ? 206 : 200, {
    "content-type": type,
    "content-length": end - start + 1,
    "accept-ranges": "bytes",
    ...(range && { "content-range": `bytes ${start}-${end}/${size}` }),
  });
  createReadStream(file, { start, end }).pipe(res);
}).listen(0, "127.0.0.1");
await new Promise((r) => films.once("listening", r));
const filmsUrl = `http://127.0.0.1:${(films.address() as { port: number }).port}`;

// node_modules may be a link to another checkout's (a worktree's); its fonts still load.
const vite = await createServer({
  root,
  server: { port: 5198, host: "127.0.0.1", fs: { allow: [root, realpathSync(resolve(root, "node_modules"))] } },
  logLevel: "warn",
});
await vite.listen();
const app = vite.resolvedUrls?.local[0] ?? "http://127.0.0.1:5198/";

const executablePath = process.env.POLAR_E2E_CHROMIUM;
const browser = await chromium.launch(
  executablePath ? { executablePath, args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server"] } : { channel: "chrome" },
);

try {
  if (needFilms) {
    // Frames: a 16:9 backdrop and a 2:3 poster, cut from the film's own picture.
    const page = await browser.newPage();
    await page.goto(`${filmsUrl}/none`);
    for (const [key, { backdrop, poster }] of Object.entries(FRAMES)) {
      pictures.set(`${key}-backdrop.jpg`, await frame(page, key, backdrop, 1280, 720, 0.5));
      pictures.set(`${key}-poster.jpg`, await frame(page, key, poster[0], 342, 513, poster[1]));
    }
    await page.close();
  }

  if (only.includes("home"))
    await shot("home.webp", { width: 1440, height: 900 }, { films: true }, async (p) => {
      // The carousel starts with a series; the next one is Sintel.
      await p.locator(".hero-card").waitFor();
      await p.getByRole("tab", { name: "Sintel" }).click();
    });
  if (only.includes("tvmode"))
    await shot("tvmode.webp", { width: 1920, height: 1080 }, { films: true, tv: true }, async (p) => {
      // Continue Watching's first card, Sintel, has the focus; the backdrop above is its film's.
      await p.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Sintel");
    });

  // The feature table's pictures: made-up titles, drawn at a desktop size and saved at half of it.
  const small = { width: 1280, height: 800 };
  const nav = (p: Page, section: string) => p.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: section, exact: true }).click();
  const open = async (p: Page, section: string, title: string) => {
    await nav(p, section);
    await p.getByRole("button", { name: new RegExp(`^${title}\\b`) }).first().click();
    await p.getByRole("heading", { level: 1, name: title }).waitFor();
  };
  if (only.includes("show"))
    await shot("show.webp", small, { scale: 0.5 }, async (p) => {
      await open(p, "Series", "The Understudies");
      // Down to the season tabs, with the title still in sight.
      await p.mouse.wheel(0, 330);
    });
  if (only.includes("library"))
    await shot("library.webp", small, { scale: 0.5 }, async (p) => {
      // The fake shell's Library already holds a dozen titles.
      await nav(p, "Library");
      await p.getByRole("heading", { level: 1, name: "Library" }).waitFor();
    });
  if (only.includes("party"))
    await shot("party.webp", small, { scale: 0.5, account: true }, async (p) => {
      await open(p, "Movies", "The Glass Orchard");
      await p.getByRole("button", { name: "Play", exact: true }).click();
      await p.locator(".player[data-started=true]").waitFor();
      await p.getByRole("button", { name: "Watch Party", exact: true }).click();
      await p.getByRole("button", { name: "Start a Watch Party" }).click();
      await p.getByRole("button", { name: "End Party" }).waitFor();
    });
  if (only.includes("settings"))
    // Settings covers Home, whose lazy pictures then never load: no waiting for them.
    await shot("settings.webp", small, { scale: 0.5, pictures: false }, async (p) => {
      await p.getByRole("button", { name: /^Profile/ }).click();
      await p.getByRole("menuitem", { name: "Settings" }).click();
      await p.getByRole("dialog", { name: /^Settings/ }).getByRole("button", { name: /^Subtitles/ }).click();
    });
} finally {
  await browser.close();
  await vite.close();
  films.close();
}

/** One frame of a film, cut to w×h around the horizontal centre `cx`, as a JPEG. */
async function frame(page: Page, key: string, seconds: number, w: number, h: number, cx: number): Promise<Buffer> {
  const data = await page.evaluate(
    async ({ src, seconds, w, h, cx }) => {
      const video = document.createElement("video");
      video.muted = true;
      video.src = src;
      await new Promise((ok, fail) => {
        video.onloadedmetadata = ok;
        video.onerror = () => fail(new Error(`can't play ${src}: ${video.error?.message}`));
      });
      video.currentTime = seconds;
      await new Promise((ok) => (video.onseeked = ok));
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = Math.max(w / vw, h / vh);
      const sw = w / scale;
      const sh = h / scale;
      const sx = Math.min(Math.max(vw * cx - sw / 2, 0), vw - sw);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(video, sx, (vh - sh) / 2, sw, sh, 0, 0, w, h);
      video.removeAttribute("src");
      video.load();
      return canvas.toDataURL("image/jpeg", 0.88);
    },
    { src: `${filmsUrl}/${key}`, seconds, w, h, cx },
  );
  return Buffer.from(data.split(",")[1], "base64");
}

/** Every picture on screen has loaded. */
function picturesLoaded(page: Page) {
  return page.waitForFunction(() =>
    [...document.images].every((i) => {
      const r = i.getBoundingClientRect();
      return i.complete || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth;
    }),
  );
}

type ShotOptions = { films?: boolean; tv?: boolean; account?: boolean; scale?: number; pictures?: boolean };

/** The fake shell at one size, once its pictures have loaded, saved as WebP (`scale`d down, if given). */
async function shot(name: string, viewport: { width: number; height: number }, options: ShotOptions, ready: (p: Page) => Promise<void>) {
  const { films = false, tv = false, account = false, scale = 1, pictures = true } = options;
  const page = await browser.newPage({ viewport });
  await page.route("**/readme-shots/*", (route) => {
    const body = pictures.get(route.request().url().split("/").pop()!);
    return body ? route.fulfill({ body, contentType: "image/jpeg" }) : route.fulfill({ status: 404 });
  });
  // The fake shell's sources (media.example) play a silent file, as in the browser tests.
  await serveMedia(page);
  await page.addInitScript((tv) => {
    if (tv) localStorage.setItem("polar.tvMode", "1");
  }, tv);
  await page.goto(`${app}fake.html?heroAutoplay=${films ? "&films=1" : ""}${account ? "&account=1" : ""}`);
  await ready(page);
  // The pointer out of the way (in TV mode, moving it would show the mouse's own hints).
  if (!tv) await page.mouse.move(viewport.width - 2, viewport.height - 2);
  // Every picture on screen loaded, then a moment for the fades.
  if (pictures) await picturesLoaded(page);
  await page.waitForTimeout(1500);
  const png = await page.screenshot();
  const webp = await page.evaluate(
    async ({ b64, scale }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const g = canvas.getContext("2d")!;
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", scale < 1 ? 0.86 : 0.9);
    },
    { b64: png.toString("base64"), scale },
  );
  writeFileSync(resolve(root, "readme-images", name), Buffer.from(webp.split(",")[1], "base64"));
  console.log(`readme-images/${name}`);
  await page.close();
}
