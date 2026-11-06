#!/usr/bin/env bun
/**
 * A local Stremio stream addon for Blender Foundation open movies, so README
 * screenshots and recordings of the player show content anyone may show
 * (CC BY 3.0; see docs/screenshots.md for the credit each film needs).
 *
 *   bun scripts/open-films-addon.ts [--port 7878] [--file tt1254207=/path/to/big_buck_bunny.mov]
 *     [--host 0.0.0.0] [--auth user:secret] [--slow 10]
 *
 * Then in Polarity: Settings → Add-ons → add http://127.0.0.1:7878/manifest.json,
 * search for the film and play it. Sintel and Tears of Steel stream straight
 * from download.blender.org; Big Buck Bunny is only published zipped, so it
 * plays from a local file passed with --file (any of the three can be).
 *
 * Local files can stand in for a file server that wants a login (docs/stream-links.md):
 * with --auth, the add-on's link answers 302 with the credentials in the new link
 * (`http://user:secret@host/file/…`) and the file answers 401 without them; --slow
 * holds that 302 back for some seconds, like a server opening a file on demand. The
 * app doesn't check links to this computer, so to see its link check at work listen
 * on the network (--host 0.0.0.0) and add the add-on by this computer's address.
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
let hostname = "127.0.0.1";
let auth: string | undefined;
let slowMs = 0;
const files: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port") port = Number(args[++i]);
  else if (args[i] === "--host") hostname = args[++i] ?? hostname;
  else if (args[i] === "--auth") {
    auth = args[++i];
    if (!auth?.includes(":")) throw new Error("--auth wants <user>:<password>");
  } else if (args[i] === "--slow") slowMs = Number(args[++i]) * 1000;
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
  hostname,
  async fetch(req) {
    const at = new URL(req.url);
    const path = at.pathname;
    if (path === "/manifest.json") return json(manifest);
    const stream = path.match(/^\/stream\/movie\/(tt\d+)\.json$/);
    if (stream) {
      const id = stream[1];
      const film = FILMS[id];
      if (!film) return json({ streams: [] });
      const title = `${film.name} · CC BY 3.0 Blender Foundation`;
      if (!files[id]) return json({ streams: film.url ? [{ url: film.url, name: "Open films", title }] : [] });
      // A local file: its name and exact size go along as the add-on's hints.
      const file = Bun.file(files[id]);
      const behaviorHints = { filename: files[id].split(/[\\/]/).pop(), videoSize: file.size };
      return json({ streams: [{ url: `${at.origin}/${auth ? "go" : "file"}/${id}`, name: "Open films", title, behaviorHints }] });
    }
    const go = path.match(/^\/go\/(tt\d+)$/);
    if (go && auth && files[go[1]]) {
      if (slowMs) await Bun.sleep(slowMs);
      const [user, password] = auth.split(/:(.*)/s);
      const to = new URL(`/file/${go[1]}`, at.origin);
      to.username = user;
      to.password = password;
      return new Response(null, { status: 302, headers: { location: to.href } });
    }
    const file = path.match(/^\/file\/(tt\d+)$/);
    if (file && files[file[1]]) {
      if (auth && req.headers.get("authorization") !== `Basic ${btoa(auth)}`) {
        return new Response("login needed", { status: 401, headers: { "www-authenticate": 'Basic realm="open films"' } });
      }
      // Bun.file answers Range requests itself, so the player can seek.
      return new Response(Bun.file(files[file[1]]));
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`Open films addon: http://${hostname}:${server.port}/manifest.json`);
if (auth) console.log(`  local files want a login${slowMs ? `, links answer after ${slowMs / 1000} s` : ""}`);
for (const [id, film] of Object.entries(FILMS)) {
  console.log(`  ${id}  ${film.name}  ${files[id] ? `local file ${files[id]}` : (film.url ?? "needs --file")}`);
}
