/**
 * Where the app's data comes from, for Settings → About → Credits. TMDB and
 * TheTVDB ask for theirs; the rest are courtesy. docs/data-sources.md lists
 * every source. Swapping a source means
 * changing its entry here too. Bundled artwork whose licence asks for credit
 * (Twemoji's flags, CC BY 4.0) is credited here as well (docs/licensing.md).
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

/** Trakt's required line for apps using its API (developer.trakt.tv, API use policy). */
export const TRAKT_NOTICE = "Polarity is not endorsed or certified by Trakt.";

/** Simkl's mark beside "View on Simkl" (#319): whose it is and where the file came from. */
export const SIMKL_MARK_CREDIT =
  "The Simkl mark is a trademark of Simkl, shown unchanged from the file its API rules provide (api.simkl.org/api-rules); Polarity is not endorsed by Simkl.";

export const CREDITS: Credit[] = [
  { name: "TMDB", url: "https://www.themoviedb.org", use: "Catalogs, search, details, episodes, images and trailers, with your TMDB key" },
  { name: "Cinemeta (Stremio)", url: "https://www.stremio.com", use: "Catalogs and details without a TMDB key, and artwork" },
  { name: "IMDb", url: "https://www.imdb.com", use: "Title ids, trailers and cast photos" },
  { name: "AniList", url: "https://anilist.co", use: "Anime catalogs, details and seasons" },
  { name: "ani.zip", use: "Which anime is which across sites, and anime episode details" },
  { name: "Fribb/anime-lists", url: "https://github.com/Fribb/anime-lists", use: "Which anime is which across sites when ani.zip is down" },
  { name: "TheTVDB", url: "https://thetvdb.com", use: "Anime episode titles, stills and artwork, by way of ani.zip" },
  { name: "MyAnimeList, via Jikan", url: "https://jikan.moe", use: "Which anime episodes are filler or recaps" },
  { name: "MyAnimeList", url: "https://myanimelist.net", use: "Your MyAnimeList list, when a profile links it (uses the MyAnimeList API)" },
  { name: "Trakt", url: "https://trakt.tv", use: `Your Trakt history, watchlist and ratings, when a profile links it. ${TRAKT_NOTICE}` },
  { name: "Simkl", url: "https://simkl.com", use: `Your Simkl lists, history and ratings, when a profile links it (uses the Simkl API). ${SIMKL_MARK_CREDIT}` },
  { name: "Anime Filler List", url: "https://www.animefillerlist.com", use: "Filler episodes when Jikan has none" },
  { name: "AniSkip", url: "https://aniskip.com", use: "Anime opening and ending times" },
  { name: "IntroDB", url: "https://introdb.app", use: "Intro, recap and credits times" },
  { name: "MDBList", url: "https://mdblist.com", use: "Ratings, with your MDBList key" },
  { name: "OMDb", url: "https://www.omdbapi.com", use: "Ratings and awards, with your OMDb key" },
  { name: "Seekr", url: "https://seekr.tv", use: "Seek previews, with your Seekr key" },
  { name: "OpenSubtitles", url: "https://www.opensubtitles.com", use: "Subtitles" },
  {
    name: "Twemoji",
    url: "https://github.com/twitter/twemoji",
    use: "Flag emoji on Windows, in the Twemoji Country Flags font (talkjs/country-flag-emoji-polyfill), licensed CC BY 4.0",
  },
];
