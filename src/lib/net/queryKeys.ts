import type { ContentType, VideoFile } from "../types";

/**
 * Every React Query key in the app, in one place. Two queries that cache different shapes must
 * never share a key (critique C5: Discover's pages and Search's genre row did, and the window went
 * blank), so keys are only ever built here; tests/queryKeys.test.ts checks no two factories meet.
 *
 * The bare `…All` keys are prefixes for invalidating a whole family.
 */
export const keys = {
  catalog: (type: ContentType, id: string, genre = "") => ["catalog", type, id, genre] as const,
  catalogAll: ["catalog"] as const,
  meta: (type: ContentType, id: string) => ["meta", type, id] as const,
  /** Which page a title opens on (lib/anime/titlePage.ts). */
  titlePage: (type: ContentType, id: string) => ["title-page", type, id] as const,
  metaAll: ["meta"] as const,
  streams: (type: ContentType, videoId: string) => ["streams", type, videoId] as const,
  streamsAll: ["streams"] as const,
  subtitles: (type: ContentType, videoId: string | undefined, file?: VideoFile) =>
    ["subtitles", type, videoId, file?.size ?? null, file?.name ?? null] as const,
  progress: (metaId: string) => ["progress", metaId] as const,
  progressAll: ["progress"] as const,
  /** Video files opened on this device (lib/localFiles.ts); never synced. */
  recentFiles: ["recent-files"] as const,
  continue: ["continue"] as const,
  history: ["history"] as const,
  library: ["library"] as const,
  addons: ["addons"] as const,
  settings: ["settings"] as const,
  search: (q: string) => ["search", q] as const,
  recommend: (type: ContentType, id: string) => ["recommend", type, id] as const,
  featured: ["featured"] as const,

  /** Discover's paged grid (infinite query: `{ pages, pageParams }`). */
  discover: (type: ContentType, catalog: string, genre = "") => ["discover", "pages", type, catalog, genre] as const,
  /** Search's popular-in-genre row (one page: `MetaPreview[]`). */
  genreRow: (type: ContentType, genre: string) => ["discover", "row", type, genre] as const,
  discoverAll: ["discover"] as const,

  ratings: (type: ContentType, id: string, mdblistKey: string, omdbKey: string) => ["ratings", type, id, mdblistKey, omdbKey] as const,
  ratingsAll: ["ratings"] as const,
  seekr: (videoId: string, durationS: number) => ["seekr", videoId, durationS] as const,
  seekrAll: ["seekr"] as const,
  skipSegments: (videoId: string) => ["skip-segments", videoId] as const,
  trailer: (imdbId: string | undefined) => ["trailer", imdbId] as const,
  personPhoto: (name: string) => ["person-photo", name] as const,
  mpv: ["mpv"] as const,
  mpvLookahead: ["mpv", "lookahead"] as const,
  discord: ["discord"] as const,
  storeProblem: ["store-problem"] as const,
  secretsPlace: ["secrets-place"] as const,
  appVersion: ["app-version"] as const,
  marketplace: ["marketplace"] as const,

  animeLinks: ["animeLinks"] as const,
  animeCache: ["anime-cache"] as const,
  /** ani.zip's record for an AniList entry, an IMDb show or a Kitsu entry. */
  aniZip: (anilistId: number) => ["anizip", "anilist", anilistId] as const,
  aniZipImdb: (imdb: string) => ["anizip", "imdb", imdb] as const,
  aniZipKitsu: (kitsu: number) => ["anizip", "kitsu", kitsu] as const,
  anime: {
    home: ["anime", "home"] as const,
    genre: (genre: string) => ["anime", "genre", genre] as const,
    /** A genre shelf's first few cards (lib/anime/anilist.ts useAnimeGenre). */
    genreFirst: (genre: string) => ["anime", "genre-first", genre] as const,
    seasons: (anilistId: number | undefined) => ["anime", "seasons", anilistId] as const,
    /** An entry's IMDb id from the id lists on the device (landscape card art). */
    listedImdb: (anilistId: number) => ["anime", "listed-imdb", anilistId] as const,
    link: (anilistId: number) => ["anime", "link", anilistId] as const,
    media: (anilistId: number) => ["anime", "media", anilistId] as const,
    /** An entry's second page of recommendations (lib/anime/anilist.ts useMoreRecommendations). */
    moreRecommendations: (anilistId: number) => ["anime", "more-recommendations", anilistId] as const,
    schedule: (from: number, to: number) => ["anime", "schedule", from, to] as const,
    browse: (filters: object) => ["anime", "browse", filters] as const,
    imdb: (anilistId: number) => ["anime", "imdb", anilistId] as const,
    forImdb: (imdbId: string) => ["anime", "for-imdb", imdbId] as const,
    episodeFlags: (malId: number | null | undefined) => ["anime", "episodeFlags", malId] as const,
    episodeFlagsAll: ["anime", "episodeFlags"] as const,
  },
};
