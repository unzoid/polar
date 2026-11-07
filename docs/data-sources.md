# External data sources

What Polarity asks other services for, where in the code, what it needs from the user, and the
limits it works within. The owner decides which sources the app uses; a new endpoint is added here
first (see `AGENTS.md`).

## 1. Sources in use

| Source | Used for | Code | Key | Limits the app works within |
|---|---|---|---|---|
| TMDB API v3 | Catalog, search, metadata, episodes, recommendations, images, IMDb id lookup, trailers (YouTube ids), logos | `crates/index/src/tmdb.rs` | The user's own | About 40 requests a second; 429 answered with a back-off |
| Cinemeta | Catalog, search and metadata when there is no TMDB key; IMDb ids for anime ani.zip can't link | `crates/index/src/cinemeta.rs`, `src/lib/anime/search.ts` | None | None published |
| metahub images | Posters, backgrounds, logos and episode stills for IMDb ids | `cinemeta.rs`, `src/lib/account/titleDisplay.ts`, `src/lib/anime/landscapeArt.ts` | None | None published |
| IMDb GraphQL | Trailers as video files | `src-tauri/src/imdb.rs`, `trailers.rs` | None | Links expire after about a day |
| IMDb suggestion | Cast photo when the catalog has none | `src/lib/catalog/personPhoto.ts` | None | None published |
| MDBList | Scores from several sites, certification | `src-tauri/src/ratings.rs` | The user's own | 1,000 a day on the free tier, cached 6 h |
| OMDb | Scores, awards, rating | `ratings.rs` | The user's own | 1,000 a day on the free tier |
| AniList GraphQL | Anime catalog, seasons, schedule, relations, characters, search | `src/lib/anime/anilist.ts`, `src/lib/net/limiter.ts` | None | 90 a minute (30 while degraded); a 429 means a minute's wait. Requests wait in one queue, most urgent first (an opened page, then rows on screen); rows and pages are kept on the device up to a day |
| AniList account | The profile's AniList list: watched episodes, status and score from an anime's page, and the list import in Settings → Services | `src/lib/lists/`, `src/screens/settings/ServicesPage.tsx`, `src/components/anime/AnimeListPanel.tsx` | The user's own sign-in, made on AniList's page for Polarity's API client (not registered yet: the sign-in says it isn't set up) | The catalog's budget. Changes wait in a queue per profile and go out together; entries changed on AniList are read on start, 50 at most |
| MyAnimeList account | The profile's MyAnimeList list: watched episodes, status and score from an anime's page, and the list import in Settings → Services | `src/lib/lists/malList.ts`, `malSignIn.ts`, `src-tauri/src/mal.rs` | The user's own sign-in (OAuth with PKCE, no client secret) through Polarity's MyAnimeList API client, whose id the release build is given as `VITE_MAL_CLIENT_ID` (none yet: the sign-in says it isn't set up). Requests go through the app's native side, which lets only the list paths through | None published; MAL answers 403 when it thinks it is flooded, which waits like a 429. Changes wait in a queue per profile; entries changed on MAL are read on start, 50 at most |
| Jikan | Filler and recap episodes | `crates/anime/src/fillers.rs` | None | 60 a minute, 3 a second; 400 ms between pages |
| animefillerlist.com | Filler episodes when Jikan knows none | `crates/anime/src/fillers.rs` | None | One page per show, cached 24 h |
| ani.zip | Ids across anime and general sources, per-episode data, art | `src/lib/anime/anizip.ts` | None | None published |
| Fribb/anime-lists | The same ids when ani.zip can't be reached | `crates/anime/src/anime_lists.rs` | None | One file from GitHub, refreshed weekly |
| AniSkip | Opening, ending and recap times for anime | `src/lib/anime/aniskip.ts` | None | None published |
| IntroDB | Intro, recap and credits times by IMDb id | `src-tauri/src/introdb.rs` | None for reads | Rate limited, numbers not published |
| Seekr | Seek-bar thumbnails | `src-tauri/src/seekr.rs` | The user's own | Per key |
| YouTube (nocookie embed) | Trailers in the trailer player when there is no video file | `src/components/Trailer.tsx` | None | — |
| OpenSubtitles v3 add-on | Subtitles, installed by default | `src-tauri/src/lib.rs` | None | — |
| Add-ons the user installs | Streams, subtitles, catalogs | `crates/addon/src/client.rs`, `src-tauri/src/commands.rs` | Per add-on | Each add-on's own |
| Add-on list | The curated list in Settings → Add-ons | `src/lib/catalog/marketplace.ts` | None | — |
| GitHub releases API | Release notes for updates | `src/lib/updater.ts` | None | 60 unauthenticated requests an hour |
| Supabase | Accounts and sync, the owner's project | `src/lib/account/` | Owner's publishable key | `docs/supabase-storage.md` |

Every host the web view fetches from is listed in its `connect-src` policy
(`src-tauri/tauri.conf.json`, checked by `tests/webviewPolicy.test.ts`).

## 2. Decisions

- **Catalog:** TMDB when the user enters a key, Cinemeta otherwise. Keys are the user's own; the app ships none.
- **Trailers:** TMDB's first with a key, then IMDb's video file, then an add-on's or AniList's YouTube trailer. The
  backdrop behind a title's page plays video files only, never a YouTube embed.
- **Fillers:** Jikan first, animefillerlist.com when Jikan knows none, answers cached 24 h on disk.
- **Anime ids:** ani.zip first; Fribb/anime-lists, downloaded when first needed and refreshed weekly, when it can't be
  reached. The list is fetched at runtime, not shipped with the app.
- **AniList account:** the sign-in and the entries read from the list stay on the device (the system's keychain, else the
  web view's storage) and are never sent to Polarity's database; each device and profile signs in itself. Unlinking
  removes the sign-in, the queued changes and the entries kept from the list.
- **MyAnimeList account:** as with AniList, the sign-in and the entries read from the list stay on the device and are
  never sent to Polarity's database. The client id isn't in the source: the release build gets it from
  `VITE_MAL_CLIENT_ID`, and a build without one hides the sign-in. The tokens are refreshed before they run out, so a
  profile signs in again only after a month without opening Polarity. The row and the anime page say "Uses the
  MyAnimeList API".
- **Credits:** Settings → About → Credits names every source and shows TMDB's notice and logo (`src/lib/settings/credits.ts`).

## 3. What the app keeps on disk

Filler answers and the anime id list are in the app's cache folder:

| Platform | Folder |
|---|---|
| Linux | `$XDG_CACHE_HOME/app.getpolar.desktop/` (`~/.cache/app.getpolar.desktop/` when unset) |
| macOS | `~/Library/Caches/app.getpolar.desktop/` |
| Windows | `%LOCALAPPDATA%\app.getpolar.desktop\` |

- `fillers.json`: per MyAnimeList id, when it was fetched, filler and recap episode numbers and which site answered.
  Used for 24 h, kept up to 30 days as a fallback, at most 500 shows. Nothing about the user.
- `anime-list-mini.json`: the Fribb/anime-lists file (about 6 MB).
- Settings → About → Cache shows the folder and clears both files.
