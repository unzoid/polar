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
}

export interface Meta extends MetaPreview {
  runtime?: string;
  cast?: string[];
  director?: string[];
  trailerYtId?: string;
  videos: Video[];
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

export interface Manifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  logo?: string;
  types: string[];
  resources: (string | { name: string })[];
}

export interface InstalledAddon {
  manifestUrl: string;
  manifest: Manifest;
}

export interface Settings {
  tmdbKey?: string | null;
  language: string;
  bridge: string;
  autoplayNext: boolean;
  /** Seekr (seekr.tv) API key — enables seek-bar thumbnails. */
  seekrKey?: string | null;
  seekPreviews: boolean;
  metadataSource?: string;
}

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
