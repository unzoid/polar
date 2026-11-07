import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";

import * as fx from "./fixtures";
import { fakeAccount, startSignedOut } from "./account";
import type { Download } from "../../library/downloads";
import type { AnimeLink } from "../../library/identity";
import type { LibraryItem, MetaPreview, Progress, Settings } from "../../types";

/**
 * A stand-in for the native shell, for looking at the screens in a plain
 * browser (fake.html, `vite` dev server only; never in the app's build).
 * Answers every command from fixtures.ts and keeps changes in memory, so
 * the library, progress and settings behave until the page reloads. The
 * player is the built-in one (mpv is reported missing); sources link to
 * media.example, which a browser test can answer with a file to play.
 */

const library: LibraryItem[] = [...fx.library];
let addons = [...fx.addons];
const seeded = fx.DOWNLOADS ? fx.seededDownloads() : undefined;
const progress: Progress[] = [...fx.progress];
// Episodes watched through (the seeded downloads' marks): read per title only, history keeps one entry each.
const watchedEpisodes: Progress[] = seeded?.watched ?? [];
const animeLinks = new Map<number, AnimeLink>();
// A download finishes the moment it starts; the file is only a name.
let downloads: Download[] = seeded?.downloads ?? [];
// `fake.html?theme=black` and the like start with that setting changed.
const params = new URLSearchParams(location.search);
params.delete("worst"); // fixtures.ts's worst-case switch, not a setting
params.delete("films"); // and its README-screenshot switch
params.delete("downloads"); // and #15's many-downloads switch
const secretsPlace = params.get("secretsPlace") ?? "keychain"; // Settings → Account's "On this device"
params.delete("secretsPlace");
// `fake.html?account=1`: signed in, with watch parties in this page (account.ts); read by lib/account in dev builds only.
// `?account=signed-out`: the same account, starting at the sign-in screen.
if (params.get("account")) (globalThis as { __polarFakeAccount?: unknown }).__polarFakeAccount = fakeAccount;
if (params.get("account") === "signed-out") startSignedOut();
params.delete("account");
params.delete("friends"); // `&friends=1`: the profile starts with Friends on (account.ts)
let settings: Settings = { ...fx.settings, ...Object.fromEntries(params) };

type Args = Record<string, unknown>;

const deepLinks: string[] = [];
(globalThis as { __polarFakeDeepLink?: (url: string) => void }).__polarFakeDeepLink = (url) => {
  deepLinks.push(url);
  void emit("deep-link");
};

const commands: Record<string, (a: Args) => unknown> = {
  store_problem: () => null,
  secrets_place: () => secretsPlace,
  settings_get: () => ({ ...settings, metadataSource: "TMDB" }),
  settings_defaults: () => fx.settings,
  settings_set: (a) => (settings = a.settings as Settings),
  settings_reset: () => (settings = { ...fx.settings }),
  catalog: (a) => fx.catalogPage(String(a.ty), String(a.id), Number(a.skip ?? 0)),
  recommend: (a) => (a.ty === "series" ? fx.series : fx.movies).slice(3, 15),
  search: (a) => {
    const q = String(a.query).toLowerCase();
    const hit = (m: MetaPreview) => m.name.toLowerCase().includes(q);
    if (fx.WORST === "empty") return { movies: [], series: [] };
    return { movies: fx.movies.filter(hit), series: fx.series.filter(hit) };
  },
  meta: (a) => fx.meta(String(a.id)) ?? Promise.reject({ code: "not_found", message: "not found" }),
  streams: () => fx.streams(),
  subtitles: () => [],
  skip_segments: () => ({}),
  // A linked MyAnimeList list (#84): a made-up account with a short list; sign-ins aren't faked.
  mal_api: (a) => fakeMal(a as { method: string; path: string; token: string }),
  mal_token: () => Promise.reject({ code: "upstream", message: "not in the fake shell" }),
  seek_previews: () => null,
  ratings: () =>
    fx.WORST ? { rottenTomatoes: 100, audience: 0, metacritic: 100, letterboxd: 5, trakt: 100 } : { rottenTomatoes: 91, audience: 87, metacritic: 78, letterboxd: 3.9 },
  trailer: () => null,
  addons_list: () => addons,
  // Install links (#163): any example.com add-on answers; an address with "broken" in it doesn't. Installs are counted.
  addon_preview: (a) =>
    String(a.url).includes("broken")
      ? Promise.reject({ code: "network", message: "network: error sending request" })
      : { id: "example.linked", version: "1.0.0", name: "Linked Add-on", description: "An add-on from an install link.", types: ["movie"], resources: ["stream"] },
  addon_install: (a) => {
    const w = window as { __addonInstalls?: string[] };
    (w.__addonInstalls ??= []).push(String(a.url));
    const addon = { manifestUrl: String(a.url), manifest: { id: "example.linked", version: "1.0.0", name: "Linked Add-on", types: ["movie"], resources: ["stream"] } };
    addons = [...addons.filter((x) => x.manifest.id !== addon.manifest.id), addon as (typeof addons)[number]];
    return addon;
  },
  // Open Stremio links in Polarity (#163): each change is kept for browser tests to read.
  stremio_links_set: (a) => void ((window as { __stremioLinks?: boolean[] }).__stremioLinks ??= []).push(!!a.on),
  addon_catalog: (a) => fx.addonCatalog(String(a.addon), String(a.ty), String(a.id), a.extra as [string, string][]),
  addons_bundled: () => [],
  library_list: () => library,
  library_toggle: (a) => {
    const item = a.item as MetaPreview;
    const at = library.findIndex((l) => l.id === item.id);
    if (at >= 0) library.splice(at, 1);
    else library.unshift({ id: item.id, type: item.type, name: item.name, poster: item.poster, addedAt: Date.now() });
    return at < 0;
  },
  progress_for: (a) => [...progress, ...watchedEpisodes].filter((p) => p.metaId === a.metaId),
  progress_save: (a) => void progress.unshift(a.progress as Progress),
  progress_save_many: () => undefined,
  library_import: (a) => {
    const { library: items, progress: rows } = a as { library: LibraryItem[]; progress: Progress[] };
    const fresh = items.filter((i) => !library.some((l) => l.id === i.id));
    library.unshift(...fresh);
    progress.unshift(...rows);
    return { library: fresh.length, progress: rows.length };
  },
  continue_watching: () => progress,
  watch_history: () => progress,
  anime_links: () => [...animeLinks.values()],
  link_anime: (a) => {
    const link = (a as { link: Omit<AnimeLink, "updatedAt"> }).link;
    animeLinks.set(link.anilist, { ...link, updatedAt: Date.now() });
    return true;
  },
  anime_ids: () => null,
  anime_episode_flags: () => ({ filler: [], recap: [] }),
  anime_cache: () => ({ path: "~/.cache/polar/anime", bytes: 1_843_200 }),
  downloads_list: () => downloads,
  // Files on this device (#204): none opened, and the file dialog is cancelled.
  local_recent: () => [],
  local_pick: () => [],
  download_start: (a) => {
    const { req } = a as { req: Omit<Download, "id" | "file" | "received" | "state" | "addedAt"> & { videoId: string } };
    const { videoId, ...rest } = req;
    const nulls = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== null));
    downloads = [{ ...nulls, id: videoId, file: `/downloads/${videoId}.mkv`, received: 1, total: 1, state: "done", addedAt: Date.now() } as Download, ...downloads];
  },
  download_remove: (a) => void (downloads = downloads.filter((d) => d.id !== a.id)),
  download_reveal: () => undefined,
  // Notifications (#209): what would be shown or planned is kept for browser tests to read.
  notifications_permission: () => "granted",
  notifications_request: () => "granted",
  notifications_show: (a) => void ((window as { __notes?: unknown[] }).__notes ??= []).push(a.note),
  notifications_plan: (a) => void ((window as { __plannedNotes?: unknown }).__plannedNotes = a.notes),
  notifications_take_launch: () => null,
  download_pause: (a) => void (downloads = downloads.map((d) => (d.id === a.id ? { ...d, state: "paused" } : d))),
  download_resume: (a) => void (downloads = downloads.map((d) => (d.id === a.id ? { ...d, state: "downloading" } : d))),
  downloads_storage: () => ({ dir: "~/Videos/Polarity", free: null }),
  controllers_list: () => [],
  mpv_available: () => false,
  // Discord: what the player sends is kept for browser tests to read.
  discord_available: () => true,
  discord_presence: (a) => void ((window as { __discord?: unknown[] }).__discord ??= []).push(a.activity),
  // polarity:// links, and stremio:// ones (#163), as `__polarFakeDeepLink(url)` opens them (#153).
  deep_links_take: () => deepLinks.splice(0),
  resolve_stream: (a) => {
    const stream = a.stream as { url?: string; infoHash?: string };
    return stream.infoHash ? { kind: "torrent" } : { kind: "url", url: stream.url };
  },
  // Each open is counted for browser tests (#137); the fake has no engine.
  torrent_open: () => {
    const w = window as { __torrentOpens?: number };
    w.__torrentOpens = (w.__torrentOpens ?? 0) + 1;
    return Promise.reject({ code: "unsupported", message: "Torrent sources play in the desktop app." });
  },
  torrent_close: () => undefined,
  stream_probe: (a) => a.url,
  // One source a placeholder, the rest quick (#21).
  stream_ready: (a) =>
    String(a.url).endsWith("/1.mp4")
      ? { state: "notReady", reason: "Not ready at the source" }
      : String(a.url).endsWith(".html")
        ? { state: "notReady", reason: "Answered with a page, not a video" }
        : { state: "ready", ms: 400 },
  space_untitled: () => [],
  sync_changes: () => ({ library: [], progress: [], links: [], cursor: 0, pulledAt: null }),
  // Window, app and plugin calls: answered with nothing.
  "plugin:app|version": () => "0.17.0",
  "plugin:window|is_fullscreen": () => false,
  "plugin:window|is_maximized": () => false,
  "plugin:window|is_minimized": () => false,
  // Pin window (#266): what the window was told is kept for browser tests to read.
  window_can_pin: () => true,
  ...Object.fromEntries(
    ["set_always_on_top", "set_resizable", "set_minimizable", "set_maximizable"].map((name) => [
      `plugin:window|${name}`,
      (a: Args) => void (((window as { __window?: Record<string, unknown> }).__window ??= {})[name] = a.value),
    ]),
  ),
};

/** The native MyAnimeList relay's answer for the fake account: its whole list, an entry, a change saved. */
function fakeMal({ method, path, token }: { method: string; path: string; token: string }) {
  const answer = (body: unknown) => ({ status: 200, body: JSON.stringify(body) });
  if (!token) return { status: 401, body: "" };
  const status = (s: string, watched: number) => ({ status: s, score: 0, num_episodes_watched: watched, is_rewatching: false, num_times_rewatched: 0, updated_at: "2026-01-02T00:00:00Z" });
  const node = (id: number, media_type: string, nsfw = "white") => ({ id, title: `Show ${id}`, num_episodes: media_type === "movie" ? 1 : 12, media_type, nsfw });
  if (path === "users/@me") return answer({ id: 77, name: "Lanternfield Fan" });
  if (path === "users/@me/animelist")
    return answer({
      data: [
        { node: node(101, "tv"), list_status: status("watching", 3) },
        { node: node(102, "movie"), list_status: status("completed", 1) },
        { node: node(103, "tv", "black"), list_status: status("plan_to_watch", 0) },
      ],
      paging: {},
    });
  if (method === "GET" && path.startsWith("anime/")) return answer({ id: Number(path.slice(6)) });
  if (method === "PATCH") return answer(status("watching", 1));
  return { status: 200, body: "" };
}

mockWindows("main");
mockIPC(
  (cmd, payload) => {
    const answer = commands[cmd];
    if (!answer) {
      if (!cmd.startsWith("plugin:")) console.debug("[fake shell] no answer for", cmd, payload);
      return null;
    }
    return answer((payload ?? {}) as Args);
  },
  { shouldMockEvents: true },
);

// A click on a note, as the native shell reports it (#209).
(window as { __polarFakeNoteClick?: (payload: string) => void }).__polarFakeNoteClick = (payload) => void emit("notification://click", payload);
