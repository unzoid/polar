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
 */
import { createServer as httpServer } from "node:http";
import { createReadStream, realpathSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { createServer } from "vite";

/** Seconds into each film for its backdrop, and for its poster with the poster's horizontal centre (0 to 1). */
const FRAMES: Record<string, { backdrop: number; poster: [number, number] }> = {
  sintel: { backdrop: 270, poster: [300, 0.44] },
  "tears-of-steel": { backdrop: 40, poster: [200, 0.3] },
  "big-buck-bunny": { backdrop: 120, poster: [240, 0.4] },
};

const args = process.argv.slice(2);
const files: Record<string, string> = {};
for (const key of Object.keys(FRAMES)) {
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
  // Frames: a 16:9 backdrop and a 2:3 poster, cut from the film's own picture.
  const page = await browser.newPage();
  await page.goto(`${filmsUrl}/none`);
  for (const [key, { backdrop, poster }] of Object.entries(FRAMES)) {
    pictures.set(`${key}-backdrop.jpg`, await frame(page, key, backdrop, 1280, 720, 0.5));
    pictures.set(`${key}-poster.jpg`, await frame(page, key, poster[0], 342, 513, poster[1]));
  }
  await page.close();

  await shot("home.webp", { width: 1440, height: 900 }, false, async (p) => {
    // The carousel starts with a series; the next one is Sintel.
    await p.locator(".hero-card").waitFor();
    await p.getByRole("tab", { name: "Sintel" }).click();
  });
  await shot("tvmode.webp", { width: 1920, height: 1080 }, true, async (p) => {
    // Continue Watching's first card, Sintel, has the focus; the backdrop above is its film's.
    await p.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Sintel");
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

/** The fake shell at one size, once its pictures have loaded, saved as WebP. */
async function shot(name: string, viewport: { width: number; height: number }, tv: boolean, ready: (p: Page) => Promise<void>) {
  const page = await browser.newPage({ viewport });
  await page.route("**/readme-shots/*", (route) => {
    const body = pictures.get(route.request().url().split("/").pop()!);
    return body ? route.fulfill({ body, contentType: "image/jpeg" }) : route.fulfill({ status: 404 });
  });
  await page.addInitScript((tv) => {
    if (tv) localStorage.setItem("polar.tvMode", "1");
  }, tv);
  await page.goto(`${app}fake.html?films=1&heroAutoplay=`);
  await ready(page);
  // The pointer out of the way (in TV mode, moving it would show the mouse's own hints).
  if (!tv) await page.mouse.move(viewport.width - 2, viewport.height - 2);
  // Every picture on screen loaded, then a moment for the fades.
  await page.waitForFunction(() =>
    [...document.images].every((i) => {
      const r = i.getBoundingClientRect();
      return i.complete || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth;
    }),
  );
  await page.waitForTimeout(1500);
  const png = await page.screenshot();
  const webp = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return canvas.toDataURL("image/webp", 0.9);
  }, png.toString("base64"));
  writeFileSync(resolve(root, "readme-images", name), Buffer.from(webp.split(",")[1], "base64"));
  console.log(`readme-images/${name}`);
  await page.close();
}
