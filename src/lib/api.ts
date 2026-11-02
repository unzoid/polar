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
  SkipSegments,
  LocalChanges,
  SyncLibraryItem,
} from "./types";
import { settingsChanged } from "./settingsChanges";

export const isTauri = "__TAURI_INTERNALS__" in window;

/** Pass a result through, telling settings sync something it covers changed. */
function changed<T>(value: T): T {
  settingsChanged();
  return value;
}

/** Thin typed wrappers over the Rust commands in src-tauri/src/commands.rs. */
export const api = {
  /** Opens an https page in the default browser. */
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  catalog: (type: ContentType, id: string, skip = 0, genre?: string) =>
    invoke<MetaPreview[]>("catalog", { ty: type, id, skip, genre }),
  /** Titles like `id`, for "Because you watched …". */
  recommend: (type: ContentType, id: string) => invoke<MetaPreview[]>("recommend", { ty: type, id }),
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
  skipSegments: (videoId: string) => invoke<SkipSegments>("skip_segments", { videoId }),
  seekrValidate: (key: string) => invoke<string | null>("seekr_validate", { key }),

  addons: () => invoke<InstalledAddon[]>("addons_list"),
  installAddon: (url: string) => invoke<InstalledAddon>("addon_install", { url }).then(changed),
  removeAddon: (id: string) => invoke<void>("addon_remove", { id }).then(changed),

  library: () => invoke<LibraryItem[]>("library_list"),
  toggleLibrary: (item: MetaPreview) => invoke<boolean>("library_toggle", { item }),
  progressFor: (metaId: string) => invoke<Progress[]>("progress_for", { metaId }),
  saveProgress: (progress: Progress) => invoke<void>("progress_save", { progress }),
  continueWatching: () => invoke<Progress[]>("continue_watching"),
  /** The latest video per title you've watched (finished or under way), newest first. */
  watchHistory: () => invoke<Progress[]>("watch_history"),

  // Profile spaces & sync (src-tauri/src/sync.rs). `space` = profile id.
  activateSpace: (space: string | null) => invoke<void>("space_activate", { space }),
  importLocalInto: (space: string) => invoke<void>("space_import_local", { space }),
  forgetSpace: (space: string | null) => invoke<void>("space_forget", { space }),
  syncChanges: (space: string) => invoke<LocalChanges>("sync_changes", { space }),
  syncMarkPushed: (space: string, cursor: number) => invoke<void>("sync_mark_pushed", { space, cursor }),
  syncApply: (space: string, library: SyncLibraryItem[], progress: Progress[], pulledAt: string | null) =>
    invoke<boolean>("sync_apply", { space, library, progress, pulledAt }),

  settings: () => invoke<Settings>("settings_get"),
  saveSettings: (settings: Settings) => invoke<Settings>("settings_set", { settings }).then(changed),
  /** Defaults again, keeping API keys, the bridge and the metadata language. */
  resetSettings: () => invoke<Settings>("settings_reset").then(changed),

  mpvAvailable: () => invoke<boolean>("mpv_available"),
};
