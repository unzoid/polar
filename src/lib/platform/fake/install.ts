import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

import * as fx from "./fixtures";
import type { LibraryItem, MetaPreview, Progress, Settings } from "../../types";

/**
 * A stand-in for the native shell, for looking at the screens in a plain
 * browser (fake.html, `vite` dev server only; never in the app's build).
 * Answers every command from fixtures.ts and keeps changes in memory, so
 * the library, progress and settings behave until the page reloads. The
 * player has nothing to play: mpv is reported missing and sources fail.
 */

const library: LibraryItem[] = [...fx.library];
const progress: Progress[] = [...fx.progress];
let settings: Settings = { ...fx.settings };

type Args = Record<string, unknown>;

const commands: Record<string, (a: Args) => unknown> = {
  store_problem: () => null,
  settings_get: () => ({ ...settings, metadataSource: "TMDB" }),
  settings_defaults: () => fx.settings,
  settings_set: (a) => (settings = a.settings as Settings),
  settings_reset: () => (settings = { ...fx.settings }),
  catalog: (a) => fx.catalogPage(String(a.ty), String(a.id), Number(a.skip ?? 0)),
  recommend: (a) => (a.ty === "series" ? fx.series : fx.movies).slice(3, 15),
  search: (a) => {
    const q = String(a.query).toLowerCase();
    const hit = (m: MetaPreview) => m.name.toLowerCase().includes(q);
    return { movies: fx.movies.filter(hit), series: fx.series.filter(hit) };
  },
  meta: (a) => fx.meta(String(a.id)) ?? Promise.reject({ code: "not_found", message: "not found" }),
  streams: () => fx.streams(),
  subtitles: () => [],
  skip_segments: () => ({}),
  seek_previews: () => null,
  ratings: () => ({ rottenTomatoes: 91, audience: 87, metacritic: 78, letterboxd: 3.9 }),
  trailer: () => null,
  addons_list: () => fx.addons,
  library_list: () => library,
  library_toggle: (a) => {
    const item = a.item as MetaPreview;
    const at = library.findIndex((l) => l.id === item.id);
    if (at >= 0) library.splice(at, 1);
    else library.unshift({ id: item.id, type: item.type, name: item.name, poster: item.poster, addedAt: Date.now() });
    return at < 0;
  },
  progress_for: (a) => progress.filter((p) => p.metaId === a.metaId),
  progress_save: (a) => void progress.unshift(a.progress as Progress),
  progress_save_many: () => undefined,
  continue_watching: () => progress,
  watch_history: () => progress,
  anime_links: () => [],
  link_anime: () => false,
  anime_ids: () => null,
  anime_episode_flags: () => ({ filler: [], recap: [] }),
  anime_cache: () => ({ path: "~/.cache/polar/anime", bytes: 1_843_200 }),
  downloads_list: () => [],
  controllers_list: () => [],
  mpv_available: () => false,
  resolve_stream: () => ({ kind: "unsupported", reason: "The fake shell plays nothing." }),
  space_untitled: () => [],
  sync_changes: () => ({ library: [], progress: [], links: [], cursor: 0, pulledAt: null }),
  // Window, app and plugin calls: answered with nothing.
  "plugin:app|version": () => "0.17.0",
  "plugin:window|is_fullscreen": () => false,
  "plugin:window|is_maximized": () => false,
  "plugin:window|is_minimized": () => false,
};

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
