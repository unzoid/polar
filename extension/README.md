# Open in Polarity (browser extension)

Adds an **Open in Polarity** button to a title's page on film, TV and anime database sites, and **Watch
together in Polarity** to YouTube video pages and to the context menu of links to video files and streams
(GitHub #208). Chrome and Firefox, from the same code.

## What it does

| Where | Button | Opens |
| --- | --- | --- |
| IMDb `/title/tt…` (a film or show, by the page's `og:type`; not episodes) | Open in Polarity | the title |
| TMDB `/movie/<id>`, `/tv/<id>` | Open in Polarity | the title, found by its IMDb id with the user's TMDB key |
| AniList `/anime/<id>`, MyAnimeList `/anime/<id>` | Open in Polarity | the anime's page (MyAnimeList ids looked up on AniList) |
| Trakt `/movies/<slug>`, `/shows/<slug>`; Letterboxd `/film/<slug>/` | Open in Polarity | the title, from the page's links to its IMDb or TMDB page |
| YouTube `watch?v=`, Shorts, `/live/` | Watch together in Polarity | a watch party on the video, from where it's playing |
| Right-click a link to `.mp4` `.mkv` `.webm` `.m3u8` `.mpd`, or a tab showing one | Watch together in Polarity | a watch party on that link |

Lists, searches, people and a title's sub-pages show nothing. Each button opens a page on the website
(`/watch/?type=…&id=…`, or `/party/#u=…` with the video's link in the fragment, which the browser doesn't send to
the server) that hands the link to Polarity as a `polarity://` link, or offers the download. Polarity checks it
again, and shows the video's link and asks before a watch party starts (Watch a Link's rules: no pages, no
extracting video from other sites' players).

**Permissions:** the listed sites only (no access to every site) and `contextMenus`. No storage, no background
reading, no network requests of its own.

## Build and test

From this folder, with Bun (the tests use the repository's `happy-dom`, so run `bun install` at the top first):

```sh
bun run test       # id parsing, the button in stand-in pages, the context menu
bun run typecheck
bun run build      # dist/chrome and dist/firefox
```

- **Chrome:** `chrome://extensions` → Developer mode → Load unpacked → `dist/chrome`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist/firefox/manifest.json`.

The icons are the app's (`src-tauri/icons`), copied in by the build.

## Safari

Safari on macOS and iOS needs a small app around the extension; that goes with the iOS distribution question
and isn't here.
