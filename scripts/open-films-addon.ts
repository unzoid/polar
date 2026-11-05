#!/usr/bin/env bun
/**
 * A local Stremio stream addon for Blender Foundation open movies, so README
 * screenshots and recordings of the player show content anyone may show
 * (CC BY 3.0; see docs/screenshots.md for the credit each film needs).
 *
 *   bun scripts/open-films-addon.ts [--port 7878] [--file tt1254207=/path/to/big_buck_bunny.mov]
 *
 * Then in Polarity: Settings → Add-ons → add http://127.0.0.1:7878/manifest.json,
 * search for the film and play it. Sintel and Tears of Steel stream straight
 * from download.blender.org; Big Buck Bunny is only published zipped, so it
 * plays from a local file passed with --file (any of the three can be).
 */

interface Film {
  name: string;
  /** Direct file on download.blender.org, if one is published unzipped. */
  url?: string;
}

const FILMS: Record<string, Film> = {
  tt1727587: { name: "Sintel (2010)", url: "https://download.blender.org/durian/movies/Sintel.2010.1080p.mkv" },
  tt0000107: { name: "Tears of Steel (2012)", url: "https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov" },
  tt1254207: { name: "Big Buck Bunny (2008)" },
};

const args = Bun.argv.slice(2);
let port = 7878;
const files: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") port = Number(args[++i]);
  else if (args[i] === "--file") {
    const [id, path] = (args[++i] ?? "").split(/=(.*)/s);
    if (!FILMS[id] || !path) throw new Error(`--file wants <imdb id>=<path>, with one of: ${Object.keys(FILMS).join(", ")}`);
    if (!(await Bun.file(path).exists())) throw new Error(`no such file: ${path}`);
    files[id] = path;
  } else throw new Error(`unknown argument: ${args[i]}`);
}

const manifest = {
  id: "local.polar.open-films",
  version: "1.0.0",
  name: "Open films (local)",
  description: "Blender Foundation open movies, CC BY 3.0, for screenshots",
  resources: ["stream"],
  types: ["movie"],
  idPrefixes: ["tt"],
  catalogs: [],
};

const json = (body: unknown) => Response.json(body, { headers: { "access-control-allow-origin": "*" } });

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/manifest.json") return json(manifest);
    const stream = path.match(/^\/stream\/movie\/(tt\d+)\.json$/);
    if (stream) {
      const id = stream[1];
      const film = FILMS[id];
      const url = files[id] ? `http://127.0.0.1:${server.port}/file/${id}` : film?.url;
      return json({ streams: film && url ? [{ url, name: "Open films", title: `${film.name} · CC BY 3.0 Blender Foundation` }] : [] });
    }
    const file = path.match(/^\/file\/(tt\d+)$/);
    // Bun.file answers Range requests itself, so the player can seek.
    if (file && files[file[1]]) return new Response(Bun.file(files[file[1]]));
    return new Response("not found", { status: 404 });
  },
});

console.log(`Open films addon: http://127.0.0.1:${server.port}/manifest.json`);
for (const [id, film] of Object.entries(FILMS)) {
  console.log(`  ${id}  ${film.name}  ${files[id] ? `local file ${files[id]}` : (film.url ?? "needs --file")}`);
}
