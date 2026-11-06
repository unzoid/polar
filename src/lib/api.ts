import { call as native } from "./platform/bridge";
import { noteSaveFailure } from "./errors";
import { playContext } from "./anime/playContext";
import { isKitsuId, kitsuMeta } from "./anime/kitsu";
import type {
  CacheInfo,
  Imported,
  ContentType,
  ExternalRatings,
  InstalledAddon,
  LibraryItem,
  Meta,
  MetaPreview,
  Playable,
  Readiness,
  Progress,
  Settings,
  Stream,
  StreamsResult,
  SearchResults,
  SubtitleOption,
  SeekTrack,
  SkipSegments,
  LocalChanges,
  Pushed,
  SyncLibraryItem,
  TitleDisplay,
  TitleRef,
} from "./types";
import { settingsChanged } from "./settings/changes";
import type { AnimeLink } from "./library/identity";
import type { DiscordActivity } from "./playback/discordPresence";

/** A native command; a change it couldn't save is reported app-wide (errors.ts onSaveFailure) and still rejects. */
const call = <T = unknown>(command: string, args?: Record<string, unknown>) =>
  native<T>(command, args).catch((e: unknown) => {
    noteSaveFailure(e);
    throw e;
  });

/** Pass a result through, telling settings sync something it covers changed. */
function changed<T>(value: T): T {
  settingsChanged();
  return value;
}

/** Thin typed wrappers over the Rust commands in src-tauri/src/commands.rs. */
export const api = {
  /** Opens an https page in the default browser. */
  openExternal: (url: string) => call<void>("open_external", { url }),
  /** The anime cache folder (fillers.json, anime-list-mini.json) and their size. */
  animeCache: () => call<CacheInfo>("anime_cache"),
  animeCacheClear: () => call<void>("anime_cache_clear"),
  catalog: (type: ContentType, id: string, skip = 0, genre?: string) =>
    call<MetaPreview[]>("catalog", { ty: type, id, skip, genre }),
  /** Titles like `id`, for "Because you watched …". */
  recommend: (type: ContentType, id: string) => call<MetaPreview[]>("recommend", { ty: type, id }),
  search: (query: string) => call<SearchResults>("search", { query }),
  // Anime with no IMDb page carry a Kitsu id; no metadata addon serves those, so they're built from AniList.
  meta: (type: ContentType, id: string) => (isKitsuId(id) ? kitsuMeta(type, id) : call<Meta>("meta", { ty: type, id })),
  streams: (type: ContentType, videoId: string) =>
    call<StreamsResult>("streams", { ty: type, videoId, altIds: playContext.altIds(videoId) ?? null }),
  resolveStream: (stream: Stream) => call<Playable>("resolve_stream", { stream }),
  /** The link check mpv_load runs, for the built-in player: the URL to open, or why it won't play. */
  streamProbe: (url: string, probeId: number, headers: Record<string, string> | null = null) =>
    call<string>("stream_probe", { url, probeId, headers }),
  /** One look at a source's link ahead of time (#21): ready to play, or why not. */
  streamReady: (url: string, headers: Record<string, string> | null = null) => call<Readiness>("stream_ready", { url, headers }),
  subtitles: (type: ContentType, videoId: string) =>
    call<SubtitleOption[]>("subtitles", { ty: type, videoId }),
  subtitleVtt: (url: string) => call<string>("subtitle_vtt", { url }),
  seekPreviews: (videoId: string, durationMs: number) =>
    call<SeekTrack | null>("seek_previews", { videoId, durationMs }),
  skipSegments: (videoId: string) => call<SkipSegments>("skip_segments", { videoId }),
  seekrValidate: (key: string) => call<string | null>("seekr_validate", { key }),
  /** Rotten Tomatoes, Metacritic, Letterboxd… (empty without a ratings key in Settings → Services). */
  ratings: (type: ContentType, id: string) => call<ExternalRatings>("ratings", { ty: type, id }),

  addons: () => call<InstalledAddon[]>("addons_list"),
  installAddon: (url: string) => call<InstalledAddon>("addon_install", { url }).then(changed),
  removeAddon: (id: string) => call<void>("addon_remove", { id }).then(changed),

  library: () => call<LibraryItem[]>("library_list"),
  toggleLibrary: (item: MetaPreview) => call<boolean>("library_toggle", { item }),
  progressFor: (metaId: string) => call<Progress[]>("progress_for", { metaId }),
  saveProgress: (progress: Progress) => call<void>("progress_save", { progress }),
  /** In one save; the last entry counts as the most recently touched. */
  saveProgressMany: (progress: Progress[]) => call<void>("progress_save_many", { progress }),
  /** Library items and progress from another app, keeping their times; newer entries here win. */
  importLibrary: (library: LibraryItem[], progress: Progress[]) => call<Imported>("library_import", { library, progress }),
  continueWatching: () => call<Progress[]>("continue_watching"),
  /** The latest video per title you've watched (finished or under way), newest first. */
  watchHistory: () => call<Progress[]>("watch_history"),
  /**
   * Record which id an anime is played from; library and progress kept under
   * its other ids move onto it (docs/anime-identity.md). `updatedAt` is set by
   * the backend. Resolves to whether anything changed.
   */
  linkAnime: (link: Omit<AnimeLink, "updatedAt">) =>
    call<boolean>("link_anime", { link: { ...link, updatedAt: 0 } }),
  animeLinks: () => call<AnimeLink[]>("anime_links"),

  // Profile spaces & sync (src-tauri/src/sync.rs). `space` = profile id.
  activateSpace: (space: string | null) => call<void>("space_activate", { space }),
  importLocalInto: (space: string) => call<void>("space_import_local", { space }),
  forgetSpace: (space: string | null) => call<void>("space_forget", { space }),
  syncChanges: (space: string) => call<LocalChanges>("sync_changes", { space }),
  syncMarkPushed: (space: string, pushed: Pushed) => call<void>("sync_mark_pushed", { space, pushed }),
  /** `links: null` leaves the links alone (the server has none to give). */
  syncApply: (space: string, remote: { library: SyncLibraryItem[]; progress: Progress[]; links: AnimeLink[] | null }, pulledAt: string | null) =>
    call<boolean>("sync_apply", { space, ...remote, pulledAt }),

  /** Titles pulled without a name, most recent first; `fillDisplay` fills in what was found. */
  untitled: (space: string) => call<TitleRef[]>("space_untitled", { space }),
  fillDisplay: (space: string, found: TitleDisplay[]) => call<boolean>("space_fill_display", { space, found }),

  settings: () => call<Settings>("settings_get"),
  saveSettings: (settings: Settings) => call<Settings>("settings_set", { settings }).then(changed),
  /** Every setting as it is until changed (settings sync sends only what differs). */
  settingsDefaults: () => call<Settings>("settings_defaults"),
  /** Defaults again, keeping API keys and the metadata language. */
  resetSettings: () => call<Settings>("settings_reset").then(changed),

  mpvAvailable: () => call<boolean>("mpv_available"),
  /** Whether this build can show what plays on Discord (desktop, built with a Discord application). */
  discordAvailable: () => call<boolean>("discord_available").catch(() => false),
  /** Shows what plays on the user's Discord profile, or clears it (null); nothing happens without Discord. */
  discordPresence: (activity: DiscordActivity | null) => call<void>("discord_presence", { activity }).catch(() => {}),
  /** Why saved data couldn't be read at start-up; `null` when it could. */
  storeProblem: () => call<string | null>("store_problem"),
};
