# Architecture

How Polarity is put together, where platform code may live, and what each platform it
targets provides. For the order the code was rewritten in, see `docs/rewrite-plan.md`;
for the interface components, `docs/ui-components.md`.

## 1. Layers

```
src/screens, src/components, src/tv     what people see (React)
src/lib/<domain>                         front-end logic: account, anime, catalog, library, net, party, playback, settings, ui
src/lib/platform                         the only front-end code that knows it runs in Tauri
──────────────── bridge: commands and events ────────────────
src-tauri/src                            the native shell: commands, player, downloads, store, controllers
crates/addon, anime, index, library,     the core: add-on protocol, anime ids and filler, search/metadata, library and sync,
  player                                 the player's rules (mpv allow-lists, picture/sound presets, autocrop)
  torrent                                the torrent engine for add-on torrent streams (librqbit), served on loopback
```

Rules:

- **The core crates hold no platform code.** They build and test on any system with
  `cargo test -p polar-addon -p polar-library -p polar-anime -p polar-index -p polar-player -p polar-torrent`. Their only
  `cfg` outside tests is `#[cfg(unix)]` in `crates/library/src/saver.rs`, which makes
  `polarity.json` owner-only (0600) where the system has Unix permissions; elsewhere it does
  nothing. Paths come in from the shell (`app_data_dir`, `app_cache_dir`), never from the
  crates themselves.
- **Only `src/lib/platform` imports `@tauri-apps/*`.** Everything else goes through its
  interfaces. `tests/platformBoundary.test.ts` fails if another file does.
- **The web view reaches only what its own code fetches.** `connect-src` in
  `src-tauri/tauri.conf.json` names those hosts (AniList, ani.zip, AniSkip, IMDb's suggestion API,
  GitHub's releases and the add-on list) and `*.supabase.co`; add-ons, TMDB, Cinemeta, subtitles and
  downloads go through Rust. A self-hosted account backend needs its host added there. Pictures and
  video stay open to any `https:`/`http:` host, since add-ons choose them. The web view has no
  `opener`, `fs` or `shell` permission: links open through `open_external` (https only) and files are
  revealed by download id. `tests/webviewPolicy.test.ts` checks all three.
- **Platform differences in the shell stay in the module that owns the concern** (the
  player in `player/` and `macos/`, controllers in `controllers.rs`), behind the commands
  the front end already calls, so a new platform changes that module and nothing above it.

## 2. One interface per concern

| Concern | Front end (`src/lib/platform` unless named) | Native side | How it differs by platform |
|---|---|---|---|
| Bridge | `bridge.ts`: `call(command, args)`, `on(event, handler)`, `inShell` | `tauri::generate_handler!` in `src-tauri/src/lib.rs` | Tauri carries it everywhere; nothing differs |
| Player | `components/player/mpvMedia.ts` (`MpvMedia`, the same shape as `<video>`), chosen in `screens/Player.tsx` by `mpv_available` | `player/` (`mod.rs`: `Mpv`, `Engine`, the IPC reader; `commands.rs`: the `mpv_*` commands; `autocrop.rs`; `ipc.rs`), `macos/mpv_view.m`, `streamcheck.rs`; what any engine follows in `crates/player` (allow-lists, `Tune`, `CropTracker`/`zoom_for`) | Windows: mpv process drawing into the window (`--wid`). macOS: libmpv in the app. Elsewhere `mpv_available` is false and the webview's `<video>` plays |
| Storage | `lib/settings/prefs.ts` (device prefs in `localStorage`), `lib/api.ts` for the rest | `store.rs` + `polar_library::saver` (`polarity.json` in the app data folder), `downloads.rs` | Tauri picks the folders (`app_data_dir`, `app_cache_dir`) per system |
| Keys | `lib/account/secrets.ts` (sealing with the optional passphrase); `keychain.ts`: the sign-in session's storage, falling back to `localStorage` | API keys: `polarity.json` (`store.rs`), owner-only on Unix. Session: `keychain.rs` over the `keyring` crate, laid out by `polar_library::keychain` (split under Windows' 2,560-byte limit) | Keychain on macOS, Credential Manager on Windows, Secret Service on Linux (none running: the web view keeps it). Phones/TV: no keychain wired yet, the web view's storage |
| Window | `window.ts`: `AppWindow` (minimise, maximise, close, fullscreen, focus, resize, zoom) | Tauri window, `tauri.conf.json`, `tauri.macos.conf.json`, `tauri.windows.conf.json` | Windows/Linux draw our buttons (`components/WindowControls.tsx`), macOS keeps its traffic lights; on phones and TVs the window is the screen |
| Input | keyboard and pointer in the webview; `tv/gamepad.ts` (Gamepad API + native hot-plug); `lib/settings/keybinds.ts` | `controllers.rs` (gilrs: hot-plug only) | ⌘ vs Ctrl (`device.ts` `MOD`); TV remotes send arrow keys and Back, which TV mode already uses |
| Updates | `updates.ts`: `AppUpdates` (`canUpdate`, `version`, `check`, `relaunch`); state in `lib/updater.ts` | `tauri-plugin-updater` + `tauri-plugin-process`, desktop only (`src-tauri/Cargo.toml`, `#[cfg(desktop)]` in `lib.rs`, permissions in `capabilities/desktop.json`) | Desktop updates itself from the signed `latest.json`; app stores update phone and TV builds, so `canUpdate` is false there |
| Device | `device.ts`: `os`, `osName`, `isMac`, `isDesktop`, `MOD`, `MOD_LABEL`; `formFactor.ts`: `formFactor()`, `onFormFactor` (phone, tablet or desktop, touch; §4) | — | Read from the webview's navigator and screen (`detectOs`, `formFactorOf`, tested in `tests/device.test.ts`, `tests/formFactor.test.ts`) |

## 3. What each platform provides

"Built" means the code is in the tree; nothing here was run on a real device from this
machine (see `docs/unverified.md`).

| Platform | Shell | Player | Storage and keys | Window | Input | Updates | State |
|---|---|---|---|---|---|---|---|
| Windows | Tauri 2, WebView2 | mpv process in the window (bundled by `scripts/fetch-mpv.ts`), `<video>` without it | `polarity.json` in `%APPDATA%` (Tauri's app data folder) | frameless, our buttons | keyboard, mouse, controllers (gilrs: XInput / Windows.Gaming.Input) | self-update, quiet installer | built |
| macOS | Tauri 2, WKWebView | libmpv inside the app (`macos/mpv_view.m`) | app data folder, 0600 | transparent title bar, system traffic lights | keyboard (⌘), trackpad, controllers (gilrs: IOKit) | self-update | built |
| Linux | Tauri 2, WebKitGTK | `<video>` only: mpv can't draw into a GTK window yet, so `mpv_available` is false | XDG data folder, 0600 | our buttons | keyboard, mouse, controllers (gilrs: evdev) | self-update for an AppImage install, if a release carries one | built; mpv embedding not built |
| Android (phone, tablet) | Tauri 2 mobile, Android System WebView (`mobile_entry_point` in `lib.rs`) | libmpv inside the app, drawing into a `SurfaceView` behind the web view (`player/android.rs`, built in CI by `scripts/android-mpv.sh`); `<video>` when the APK has no libmpv | app-private storage | the whole screen | touch; the back button and gesture as Back (`lib/platform/back.ts`, `lib/ui/systemBack.ts`: open layer, page, Home, then the app closes); the web view ends at the on-screen keyboard (`MainActivity.kt`); keyboard and controllers through the WebView | Play Store / sideload; `canUpdate` false | project in `src-tauri/gen/android`, debug APK built in CI, started in an emulator nightly (`e2e/android/smoke.sh`; never run on a device yet); phone and tablet layouts built (§4) |
| iOS, iPadOS | Tauri 2 mobile, WKWebView | `<video>` (AVFoundation: HEVC yes, MKV/AC3/DTS no); a libmpv view is cycle 3 work | app sandbox | the whole screen | touch; controllers through the Gamepad API | App Store; `canUpdate` false | not built: no Xcode project; phone and tablet layouts built (§4), not yet seen on a device |
| Android TV | the Android build with a leanback launcher entry and a 320x180 banner; touch screen not required | as Android | as Android | fullscreen, TV mode on at every start (`MainActivity.kt` tells the page through `polarDevice.isTv()`, `isTvDevice` in `lib/platform/device.ts`) | remote D-pad as arrow keys, Back (the system Back as Escape; Back with only the menu open on Home leaves), controllers | Play Store | built into the same APK (manifest, banner, TV mode at start); never run on a TV or the TV emulator |
| Apple TV (tvOS) | none yet: tvOS has no web view, and Tauri 2 doesn't target it | — | — | — | — | — | needs a native tvOS app (SwiftUI) using the core crates through a C/Swift binding; cycle 3 decides |

## 4. Layouts from the same components

The interface is one component set (`docs/ui-components.md` §0) laid out per screen
size and input:

- **Desktop**: the default layouts in `src/screens`, pointer and keyboard first.
- **TV**: `src/tv` (`TvApp`, `TvChrome`, `shell.ts`), the same primitives with
  `variant="tv"`, focus moved by arrow keys, one Back stack (`lib/ui/dismiss.ts`).
- **Phone and tablet**: the same screens, not a third copy. `src/lib/platform/formFactor.ts`
  decides the form factor (Android and iOS: phone below a 600 px shortest side, else tablet;
  a desktop system is a tablet only with no fine pointer) and whether it's touch;
  `mirrorFormFactor` (lib/ui) puts both on the root as `data-form` and `data-touch`, and
  `useFormFactor()` gives them to components.
  - `data-form="phone"`: the tabs move to a bottom bar (`--tabbar-h`, pages pad by it), the
    bar and pages keep clear of the notch and home indicator (`--safe-top`/`--safe-bottom`,
    `viewport-fit=cover`), tighter gutters and smaller cards (tokens.css, shell.css).
  - `data-form="tablet"`: the desktop layout with safe areas.
  - `data-touch="true"`: targets at least `--hit` (44 px), and a tap on the playing video
    shows the controls instead of pausing. Hover-only effects already sit behind
    `@media (hover: hover) and (pointer: fine)`.
  - Space, not device, decides the rest: `@media (max-width: …)` breakpoints (navbar 1100/860/
    700, hero and episode list 600, detail 900, settings 820/560) apply to narrow desktop
    windows as well.
  - No window buttons off the desktop (`WindowControls`).

## 5. Adding a platform

1. Make the shell build there (`tauri android init` / `tauri ios init`); gate desktop-only
   plugins as `src-tauri/Cargo.toml` already does for the updater (and their permissions, as
   `capabilities/desktop.json` does with `platforms`).
2. If the player can do better than `<video>`, give `player/mod.rs` an engine for it (reusing
   `crates/player`'s rules) and make `mpv_available` say so; the front end needs no change.
3. Add the system to `Os` in `src/lib/platform/device.ts` if it has to be told apart.
4. Fill in its row in §3 and what can't be checked in `docs/unverified.md`.

## 6. Where each README feature lives

Each line of the README's "What's in it", from the screen to the code that does the work. Checked
against the tree at the end of the rewrite (T-011); `docs/unverified.md` says what of it could only be
read, not run, here.

| Feature | Screens and components | Logic (`src/lib`) | Native side and crates |
|---|---|---|---|
| Home: hero, Continue Watching, trending rows | `screens/Home.tsx`, `components/title/Shelf.tsx`, `Row.tsx`; TV `tv/TvScreens.tsx` | `catalog/shelves.ts`, `net/queries.ts` (`useContinueWatching`) | `commands.rs` (`catalog`, `continue_watching`), `crates/index` |
| Series and Movies pages, genres | `screens/Discover.tsx`; TV `TvScreens.tsx` | `catalog/genres.ts` | `crates/index` (`catalog` with `genre`) |
| Anime section: search, details, episodes | `screens/Anime.tsx`, `screens/AnimeDetail.tsx` (own chunk), `components/anime/*`; TV `tv/TvAnime.tsx` | `anime/*` (AniList, Kitsu, ani.zip, AniSkip; `merge.ts`, `links.ts` for one identity per show) | `crates/anime` (Fribb lists, filler), `crates/library/src/identity.rs` |
| Search with recent searches | `components/NavBar.tsx` (search field), `screens/Search.tsx`; TV `tv/TvKeyboard.tsx` | `catalog/searchQuery.ts`, `catalog/recentSearches.ts`, `anime/search.ts` | `commands.rs` (`search`), `crates/index` |
| IMDb ratings, trailers on the backdrop | `components/ImdbBadge.tsx`, `RatingRing.tsx`, `BackdropTrailer.tsx`, `Trailer.tsx` | `playback/trailers.ts` (TMDB videos first) | `ratings.rs`, `imdb.rs` |
| Calendar | `screens/Calendar.tsx` | `catalog/calendar.ts` (6 lookups at a time) | `commands.rs` (`meta`) |
| mpv inside the window | `screens/Player.tsx` (own chunk), `components/player/mpvMedia.ts` | — | `player/`, `macos/`, `crates/player` (§2) |
| Source, subtitles, audio, speed from the player bar | `components/player/OptionsOverlay.tsx`, `useTracks.ts`, `SubtitleSettings.tsx`, `SourceFilters.tsx` | `playback/sources.ts`, `playback/languages.ts` | `commands.rs` (`streams`, `subtitles`), `crates/addon` (`rank.rs`, `subs.rs`) |
| Episode shelf, Next Episode | `components/title/EpisodeShelf.tsx`, player Episodes panel and Up Next card (`Player.tsx`) | `library/episodes.ts`, `playback/autoplay.ts` | `crates/addon/src/numbering.rs` |
| Skip intros and recaps, skip filler | `components/player/SkipSegments.tsx` | `anime/aniskip.ts`, `anime/playContext.ts` (`isFiller`), `anime/episodeFlags.ts` | `introdb.rs`, `crates/anime/src/fillers.rs` |
| Subtitle, sound and picture settings mid-video | `components/player/SubtitleSettings.tsx`, `useMpvTune.ts`, Settings → Playback/Subtitles | `settings/schema.ts` | `player/commands.rs` (`mpv_tune`), `crates/player/src/tune.rs` |
| Torrent sources (desktop) | `components/player/useSource.ts` (`torrentOpen`, `torrentClose`), Settings → Sources → Torrent Sources | `playback/torrent.ts` (limits, step lines) | `torrent.rs` (`torrent_open`, `torrent_close`; the engine starts on first use, cache in `app_cache_dir/torrent-cache`), `crates/torrent` |
| Source filters, stream check | `components/SourceFilters.tsx`, `components/player/PlayerStatus.tsx` (start-up steps) | `playback/sources.ts`, `playback/startLog.ts` | `streamcheck.rs`, `crates/addon/src/probe.rs` |
| Resume | `components/player/useProgressSaver.ts`, `Player.tsx` (`resumePoint`) | `library/episodeState.ts` | `commands.rs` (`progress_save`, `progress_for`), `store.rs` |
| Watchlist, history, playlists | `screens/Library.tsx` (routes `library-collection`, `playlist`), `components/title/LibraryButton.tsx`, `PlaylistChecklist.tsx` | `library/playlists.ts`, `library/watched.ts`, `library/titleActions.ts` | `store.rs`, `crates/library` |
| Downloads | `components/DownloadButton.tsx`, Library → Downloads | `library/downloads.ts` | `downloads.rs` |
| Right-click menu on cards | `components/CardMenu.tsx`; TV `tv/TvCardMenu.tsx` | `library/titleActions.ts` | — |
| Accounts and profiles, synced | `screens/account/*` (own chunks), `components/ProfileMenu.tsx`, `Avatar.tsx` | `account/*` (`supabase.ts`, `sync.ts`, `settingsSync.ts`, `progressCodec.ts`) | `crates/library/src/sync.rs`, `supabase/migrations` (`docs/supabase-storage.md`) |
| Watch parties | `components/party/*`, `components/player/usePartySync.ts`; TV `tv/TvJoinParty.tsx` | `party/party.ts`, `party/messages.ts` | Supabase Realtime (no server of ours) |
| TV mode, controller and remote | `src/tv` (own chunk) | `settings/keybinds.ts`, `ui/dismiss.ts` | `controllers.rs` |

## 7. How sync flows

1. Every change is saved on the device first (`store.rs`, `polarity.json`); `sync.schedule()`
   (`lib/account/sync.ts`) queues a round.
2. A round pushes what changed here and pulls what other devices pushed. Each profile keeps a dirty set
   (`crates/library/src/space.rs` `Dirty`): local edits enter it, pulled rows never do, and a push clears each
   record by the time it carried (`sync_mark_pushed`), so an edit made meanwhile goes next round
   (`src-tauri/src/sync.rs` `sync_changes`; `crates/library/src/sync.rs` `merge` keeps the newest, and local names
   and pictures, since the server holds none: `docs/supabase-storage.md`). Library and history, playlists and
   settings run side by side in a round; one failing doesn't stop the others.
3. After a round, titles that arrived without a name or picture are looked up on this device
   (`lib/account/titleDisplay.ts`).
4. Settings sync separately and only what differs from the defaults (`settingsDoc.ts`); keys and
   add-on links travel with them, as they are or sealed with the optional passphrase (`secrets.ts`,
   `sealing`). Two devices' edits merge per key against the copy they last agreed on (`mergeDocs`); a
   profile's first round on a device takes the account's document but removes no add-on (`firstDoc`).
