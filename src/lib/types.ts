// Mirrors the Rust types in crates/addon and src-tauri/src/store.rs.

export type ContentType = "movie" | "series";

export interface MetaPreview {
  id: string;
  type: ContentType;
  name: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  imdbRating?: string;
  genres?: string[];
}

export interface Video {
  id: string;
  title: string;
  season: number;
  episode: number;
  released?: string;
  thumbnail?: string;
  overview?: string;
  rating?: string;
  /** A short note beside the episode number ("Filler"). */
  tag?: string;
}

export interface Meta extends MetaPreview {
  runtime?: string;
  cast?: string[];
  director?: string[];
  trailerYtId?: string;
  videos: Video[];
  /** The cast with roles and photos, where the source has them. */
  people?: Person[];
  details?: MetaDetails;
}

export interface Person {
  name: string;
  character?: string;
  photo?: string;
}

export interface MetaDetails {
  tagline?: string;
  status?: string;
  /** YYYY-MM-DD */
  released?: string;
  countries?: string[];
  languages?: string[];
  /** Networks for a show, studios for a movie. */
  studios?: string[];
  writers?: string[];
  awards?: string;
  budget?: number;
  revenue?: number;
  seasons?: number;
  episodes?: number;
  votes?: number;
  tmdbId?: number;
}

/** Scores from ratings services (Settings → Services). */
export interface ExternalRatings {
  /** Tomatometer, percent. */
  rottenTomatoes?: number | null;
  /** Rotten Tomatoes audience score, percent. */
  audience?: number | null;
  metacritic?: number | null;
  /** Out of 5. */
  letterboxd?: number | null;
  /** Percent. */
  trakt?: number | null;
  imdb?: number | null;
  imdbVotes?: number | null;
  awards?: string | null;
  rated?: string | null;
}

export interface Stream {
  url?: string;
  ytId?: string;
  content_id?: string;
  fileIdx?: number;
  externalUrl?: string;
  name?: string;
  title?: string;
  description?: string;
}

export interface StreamQuality {
  resolution?: number;
  hdr: boolean;
  dolbyVision: boolean;
  codec?: string;
  sizeBytes?: number;
  sources?: number;
  cached: boolean;
  lowQualitySource: boolean;
  direct: boolean;
  /** Audio languages the source mentions (ISO 639-1, or "multi"); empty when it says nothing. */
  languages?: string[];
  /** "Remux", "Atmos", "HDR10+", "10-bit"… */
  tags?: string[];
  /** The release group ("SubsPlease", "FLUX"), else the site it came from ("site"). */
  source?: string | null;
}

export interface RankedStream {
  stream: Stream;
  addon: string;
  quality: StreamQuality;
  score: number;
  label: string;
}

export interface StreamsResult {
  streams: RankedStream[];
  failed: string[];
  /** Left out by the filters in Settings → Sources. */
  hidden?: number;
}

export type Playable =
  | { kind: "url"; url: string }
  | { kind: "external"; url: string }
  | { kind: "unsupported"; reason: string };

export interface Progress {
  metaId: string;
  videoId: string;
  type: ContentType;
  name: string;
  background?: string;
  poster?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  stream?: Stream;
  position: number;
  duration: number;
  updatedAt: number;
}

export interface LibraryItem {
  id: string;
  type: ContentType;
  name: string;
  poster?: string;
  addedAt: number;
}

/** A library record as it travels over sync: present, or a removal. */
export interface SyncLibraryItem {
  id: string;
  type: ContentType | "";
  name: string;
  poster?: string | null;
  addedAt: number;
  deleted: boolean;
  updatedAt: number;
}

export interface LocalChanges {
  library: SyncLibraryItem[];
  progress: Progress[];
  cursor: number;
  pulledAt: string | null;
}

export interface Manifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  logo?: string;
  types: string[];
  resources: (string | { name: string })[];
  /** Null on manifests saved before hints were kept. */
  behaviorHints?: { configurable: boolean; configurationRequired: boolean } | null;
}

export interface InstalledAddon {
  manifestUrl: string;
  manifest: Manifest;
}

export type EpisodeLayout = "row" | "list";

export interface Settings {
  tmdbKey?: string | null;
  language: string;
  bridge: string;
  autoplayNext: boolean;
  /** Seekr (seekr.tv) API key — enables seek-bar thumbnails. */
  seekrKey?: string | null;
  seekPreviews: boolean;
  /** Skip intros & recaps automatically (IntroDB timings). */
  autoSkip: boolean;
  /** Preferred audio language (`en`); empty = the file's default. */
  audioLanguage: string;
  /** Preferred subtitle language; empty = off. */
  subtitleLanguage: string;
  /** Seconds the arrow keys jump. */
  seekStep: number;
  /** Play the best source immediately; off = show the source list first. */
  autoPickSource: boolean;
  /** Title under each poster/thumbnail. */
  showCardTitles: boolean;
  /** Type · genre · year under those titles. */
  showCardDetails: boolean;
  /** IMDb rating badge under each poster. */
  showCardRatings?: boolean;
  /** Tint IMDb scores by band; off = always IMDb yellow. */
  ratingColors?: boolean;
  /** A season's episodes as a horizontal shelf or a vertical list. */
  episodeLayout: EpisodeLayout;
  /** "inter" (bundled) or "system" (Segoe UI Variable on Windows). */
  uiFont: "inter" | "system";
  subtitleStyle: SubtitleStyle;
  metadataSource?: string;

  // Playback
  /** Seconds the "Up next" countdown runs. */
  autoplayCountdown: number;
  /** Ask "Still watching?" after this many autoplayed episodes in a row. 0 = never. */
  stillWatchingAfter: number;
  nextUpTiming: "credits" | "end";
  /** Skip recaps automatically; null = same as `autoSkip`. */
  autoSkipRecaps?: boolean | null;
  resumePlayback: boolean;
  /** Seconds to back up when resuming. */
  resumeRewind: number;
  /** Percent watched before a video counts as watched. */
  watchedThreshold: number;
  startFullscreen: boolean;
  timeDisplay: "remaining" | "elapsed" | "endsAt";
  controlsHideSecs: number;
  wheelAction: "volume" | "seek" | "none";
  clickAction: "toggle" | "controls";
  rememberSpeed: boolean;
  playbackSpeed: number;

  // Sources
  /** 0 = any. */
  maxResolution: number;
  /** GB; 0 = any. */
  maxMovieSizeGb: number;
  maxEpisodeSizeGb: number;
  hideCam: boolean;
  /** Comma-separated. */
  excludeKeywords: string;
  sourceSort: SourceSort;
  /** Tag filters the source list turns on by itself when some source has them ("dv", "hdr"…). */
  sourceAutoTags?: string[];
  /** Rank sources sharper than this screen below ones that match it. */
  preferScreenResolution?: boolean;
  /** Source filters hide what doesn't match (else matches go first, the rest below). */
  sourceFiltersHide?: boolean;

  // Services
  mdblistKey?: string | null;
  omdbKey?: string | null;

  // Subtitles
  subtitleMode: "always" | "foreign";

  // Appearance & browsing
  accentColor: string;
  theme: "dark" | "black";
  cardSize: "small" | "medium" | "large";
  reduceMotion: "system" | "on" | "off";
  heroAutoplay: boolean;
  showContinueWatching: boolean;
  hideEpisodeThumbs: boolean;
  hideEpisodeDescriptions: boolean;
  startPage: "home" | "library" | "movies" | "series" | "anime";
  /** Play a title's trailer behind its page after a few seconds. */
  trailerAutoplay?: boolean;
  /** …with sound. */
  trailerSound?: boolean;
  /** Where a card's IMDb rating sits. */
  cardRatingPosition?: "poster" | "below";
  /** The Calendar section (opt-in). */
  showCalendar?: boolean;
}

export type SourceSort = "best" | "quality" | "sizeDesc" | "sizeAsc" | "peers";

export interface SubtitleOption {
  id: string;
  url: string;
  lang: string;
  addon: string;
}

/** One seek-bar thumbnail: a tile within a sprite sheet. */
export interface SeekCue {
  startMs: number;
  endMs: number;
  sheet: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SeekTrack {
  cues: SeekCue[];
  sourceDurationMs: number;
}

/** A timed segment, in seconds. */
export interface Span {
  start: number;
  end: number;
}

/** IntroDB skip segments for one movie or episode. */
export interface SkipSegments {
  intro?: Span | null;
  recap?: Span | null;
  outro?: Span | null;
  postCredits?: Span | null;
}

/** How subtitles look in the player (store.rs `SubtitleStyle`). */
export interface SubtitleStyle {
  /** Percent of normal size. */
  size: number;
  /** Percent of the picture height above the usual spot. */
  raise: number;
  color: string;
  /** Percent. */
  opacity: number;
  outline: "none" | "thin" | "medium" | "thick";
  outlineColor: string;
  /** Opacity of a dark box behind the text, percent (0 = none). */
  background: number;
  /** System font family name (older saved styles may lack it). */
  font?: string;
}
