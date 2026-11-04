/**
 * Where the app's data comes from, for Settings → About → Credits. Some of
 * these terms require the credit (TMDB, TheTVDB); the rest are courtesy.
 * docs/data-sources.md has each source's terms. Swapping a source means
 * changing its entry here too.
 */
export interface Credit {
  name: string;
  /** Its site; none when it has no page of its own. */
  url?: string;
  /** What the app takes from it. */
  use: string;
}

/** TMDB's required notice, in the words of its API terms of use (themoviedb.org/api-terms-of-use). */
export const TMDB_NOTICE = "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.";

export const CREDITS: Credit[] = [
  { name: "TMDB", url: "https://www.themoviedb.org", use: "Catalogs, search, details, episodes and images, with your TMDB key" },
  { name: "Cinemeta (Stremio)", url: "https://www.stremio.com", use: "Catalogs and details without a TMDB key, and artwork" },
  { name: "IMDb", url: "https://www.imdb.com", use: "Title ids, trailers and cast photos" },
  { name: "AniList", url: "https://anilist.co", use: "Anime catalogs, details and seasons" },
  { name: "ani.zip", use: "Which anime is which across sites, and anime episode details" },
  { name: "TheTVDB", url: "https://thetvdb.com", use: "Anime episode titles, stills and artwork, by way of ani.zip" },
  { name: "MyAnimeList, via Jikan", url: "https://jikan.moe", use: "Which anime episodes are filler or recaps" },
  { name: "Anime Filler List", url: "https://www.animefillerlist.com", use: "Filler episodes when Jikan has none" },
  { name: "AniSkip", url: "https://aniskip.com", use: "Anime opening and ending times" },
  { name: "IntroDB", url: "https://introdb.app", use: "Intro, recap and credits times" },
  { name: "MDBList", url: "https://mdblist.com", use: "Ratings, with your MDBList key" },
  { name: "OMDb", url: "https://www.omdbapi.com", use: "Ratings and awards, with your OMDb key" },
  { name: "Seekr", url: "https://seekr.tv", use: "Seek previews, with your Seekr key" },
  { name: "OpenSubtitles", url: "https://www.opensubtitles.com", use: "Subtitles" },
];
