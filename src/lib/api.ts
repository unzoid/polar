import { invoke } from "@tauri-apps/api/core";
import type {
  ContentType,
  InstalledAddon,
  LibraryItem,
  Meta,
  MetaPreview,
  Playable,
  Progress,
  Settings,
  Stream,
  StreamsResult,
  SubtitleOption,
  SeekTrack,
} from "./types";

export const isTauri = "__TAURI_INTERNALS__" in window;

/** Thin typed wrappers over the Rust commands in src-tauri/src/commands.rs. */
export const api = {
  catalog: (type: ContentType, id: string, skip = 0) =>
    invoke<MetaPreview[]>("catalog", { ty: type, id, skip }),
  search: (query: string) =>
    invoke<{ movies: MetaPreview[]; series: MetaPreview[] }>("search", { query }),
  meta: (type: ContentType, id: string) => invoke<Meta>("meta", { ty: type, id }),
  streams: (type: ContentType, videoId: string) =>
    invoke<StreamsResult>("streams", { ty: type, videoId }),
  resolveStream: (stream: Stream) => invoke<Playable>("resolve_stream", { stream }),
  subtitles: (type: ContentType, videoId: string) =>
    invoke<SubtitleOption[]>("subtitles", { ty: type, videoId }),
  subtitleVtt: (url: string) => invoke<string>("subtitle_vtt", { url }),
  seekPreviews: (videoId: string, durationMs: number) =>
    invoke<SeekTrack | null>("seek_previews", { videoId, durationMs }),
  seekrValidate: (key: string) => invoke<string | null>("seekr_validate", { key }),

  addons: () => invoke<InstalledAddon[]>("addons_list"),
  installAddon: (url: string) => invoke<InstalledAddon>("addon_install", { url }),
  removeAddon: (id: string) => invoke<void>("addon_remove", { id }),

  library: () => invoke<LibraryItem[]>("library_list"),
  toggleLibrary: (item: MetaPreview) => invoke<boolean>("library_toggle", { item }),
  progressFor: (metaId: string) => invoke<Progress[]>("progress_for", { metaId }),
  saveProgress: (progress: Progress) => invoke<void>("progress_save", { progress }),
  continueWatching: () => invoke<Progress[]>("continue_watching"),

  settings: () => invoke<Settings>("settings_get"),
  saveSettings: (settings: Settings) => invoke<Settings>("settings_set", { settings }),

  mpvAvailable: () => invoke<boolean>("mpv_available"),
};
