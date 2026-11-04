import { invoke } from "@tauri-apps/api/core";
import { altIdsFor } from "./anime/altIds";
import { isKitsuId, kitsuMeta } from "./anime/kitsu";
import type {
  ContentType,
  ExternalRatings,
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
import type { AnimeLink } from "./identity";

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
  /** The anime cache folder (fillers.json, anime-list-mini.json) and their size. */
  animeCache: () => invoke<{ path: string; bytes: number }>("anime_cache"),
  animeCacheClear: () => invoke<void>("anime_cache_clear"),
  catalog: (type: ContentType, id: string, skip = 0, genre?: string) =>
    invoke<MetaPreview[]>("catalog", { ty: type, id, skip, genre }),
  /** Titles like `id`, for "Because you watched …". */
  recommend: (type: ContentType, id: string) => invoke<MetaPreview[]>("recommend", { ty: type, id }),
  search: (query: string) =>
    invoke<{ movies: MetaPreview[]; series: MetaPreview[] }>("search", { query }),
  // Anime with no IMDb page carry a Kitsu id; no metadata addon serves those, so they're built from AniList.
  meta: (type: ContentType, id: string) => (isKitsuId(id) ? kitsuMeta(type, id) : invoke<Meta>("meta", { ty: type, id })),
  streams: (type: ContentType, videoId: string) =>
    invoke<StreamsResult>("streams", { ty: type, videoId, altIds: altIdsFor(videoId) ?? null }),
  resolveStream: (stream: Stream) => invoke<Playable>("resolve_stream", { stream }),
  /** The link check mpv_load runs, for the built-in player: the URL to open, or why it won't play. */
  streamProbe: (url: string, probeId: number) => invoke<string>("stream_probe", { url, probeId }),
  subtitles: (type: ContentType, videoId: string) =>
    invoke<SubtitleOption[]>("subtitles", { ty: type, videoId }),
  subtitleVtt: (url: string) => invoke<string>("subtitle_vtt", { url }),
  seekPreviews: (videoId: string, durationMs: number) =>
    invoke<SeekTrack | null>("seek_previews", { videoId, durationMs }),
  skipSegments: (videoId: string) => invoke<SkipSegments>("skip_segments", { videoId }),
  seekrValidate: (key: string) => invoke<string | null>("seekr_validate", { key }),
  /** Rotten Tomatoes, Metacritic, Letterboxd… (empty without a ratings key in Settings → Services). */
  ratings: (type: ContentType, id: string) => invoke<ExternalRatings>("ratings", { ty: type, id }),

  addons: () => invoke<InstalledAddon[]>("addons_list"),
  installAddon: (url: string) => invoke<InstalledAddon>("addon_install", { url }).then(changed),
  removeAddon: (id: string) => invoke<void>("addon_remove", { id }).then(changed),

  library: () => invoke<LibraryItem[]>("library_list"),
  toggleLibrary: (item: MetaPreview) => invoke<boolean>("library_toggle", { item }),
  progressFor: (metaId: string) => invoke<Progress[]>("progress_for", { metaId }),
  saveProgress: (progress: Progress) => invoke<void>("progress_save", { progress }),
  /** In one save; the last entry counts as the most recently touched. */
  saveProgressMany: (progress: Progress[]) => invoke<void>("progress_save_many", { progress }),
  continueWatching: () => invoke<Progress[]>("continue_watching"),
  /** The latest video per title you've watched (finished or under way), newest first. */
  watchHistory: () => invoke<Progress[]>("watch_history"),
  /**
   * Record which id an anime is played from; library and progress kept under
   * its other ids move onto it (docs/anime-identity.md). `updatedAt` is set by
   * the backend. Resolves to whether anything changed.
   */
  linkAnime: (link: Omit<AnimeLink, "updatedAt">) =>
    invoke<boolean>("link_anime", { link: { ...link, updatedAt: 0 } }),
  animeLinks: () => invoke<AnimeLink[]>("anime_links"),

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
  /** Defaults again, keeping API keys and the metadata language. */
  resetSettings: () => invoke<Settings>("settings_reset").then(changed),

  mpvAvailable: () => invoke<boolean>("mpv_available"),
};
