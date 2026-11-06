# What could not be checked on the dev machine

The work on this branch was done on a Linux VM with no display, no WebKitGTK and no
mpv. `tsc`, `vite build`, `bun run test` and `cargo test` for the five core crates
(`polar-addon`, `polar-anime`, `polar-index`, `polar-library`, `polar-player`) run there; `src-tauri` does not build there. The
screens were looked at only in a headless Chromium against a fake shell (below,
T-051), never in the app's own window. This file lists what still needs a person
with the app, and how to check each item.

## Built by reading only (`src-tauri`)

`src-tauri` was checked with `rustfmt`, by reading and, from R4 on, with `cargo clippy
--all-targets` against stub system libraries (it type-checks; it can't link or run here).
Since R4's last steps it is also type-checked for Windows (`--target x86_64-pc-windows-gnu`, zig as the C
compiler, a stub resource compiler), so the `cfg(windows)` code (mpv as its own process, the named pipe) compiles;
the MSVC target the releases use and the macOS code (`cfg(target_os = "macos")`, `mpv_view.m`) were never compiled.
`cargo build` / `bun tauri dev` on a desktop is the first check for every item below.
Its tests (`cargo test -p polar`) were therefore never run here: since T-035 CI runs them on Linux,
Windows and macOS on every push, including the downloads resume tests (`downloads.rs`, a local
server answering ranges, whole files, the wrong part, 416, 403/503) and the error-code contract
(`contract.rs` against `contract/error-codes.json`). CI has never run: it first runs from the owner's push
(after the desktop test and the history rewrite, I-013), so until then they are unseen.

## CI workflow (`.github/workflows/ci.yml`, T-054)

CI has never run: nothing here publishes to GitHub. Checked on the dev machine instead:

- Every step of the `frontend` job: `bun install --frozen-lockfile`, `bun run test` (unit, SQL and
  the DOM component tests in `tests/dom`), `bun run build`.
- `cargo fmt --all --check`; `cargo clippy --all-targets --locked -- -D warnings` for the five core
  crates, for `src-tauri` on Linux (stub system libraries) and for `src-tauri` on
  `x86_64-pc-windows-gnu` (not the MSVC target the Windows runner uses).
- Each action's pinned commit is the commit of the tag in its comment (`git ls-remote`, 2026-11-05):
  checkout v7.0.1, setup-bun v2.2.0, rust-cache v2.9.3, cache v6.1.0, rust-toolchain `stable`.
- The Linux packages the `rust` job installs exist under those names in Ubuntu 24.04, which
  `ubuntu-latest` is (runner-images README), and in 26.04 (packages.ubuntu.com).
- The `e2e-web` job's tests (T-039, `bun run e2e`): all 12 pass in the desktop, phone and TV
  projects, three runs in a row, but in the Chromium already unpacked here (`POLAR_E2E_CHROMIUM`),
  not Playwright's own build: `playwright install` can't download here. upload-artifact v7.0.2's
  pinned commit is that tag's (GitHub API, 2026-11-05).

Not checked: the workflow file against GitHub's schema (`actionlint` could not be run here:
`actionlint .github/workflows/ci.yml` on a desktop does it), and anything about the runners
themselves: WebKitGTK linking on Ubuntu, `cargo test -p polar` anywhere, the bundled-mpv fetch and
cache on Windows, macOS, and the `desktop-webkit` end-to-end project (WebKit was never run here;
the player test in it needs WebKit to play a WAV, which Playwright's `--with-deps` should give it).
The first push shows these; a failing job prints its step and keeps the Playwright report.

## App smoke test (`.github/workflows/e2e-app.yml`, T-040)

It can't run here (the app can't link). Its first CI runs failed (#46): on Linux the script read
elements under a wrong W3C key, and on Windows the elevated runner's WebView2 dropped the driver's
DevTools port (fixed through `src-tauri/src/automation.rs`, see [testing.md](testing.md)); both
fixes are confirmed only by the next run on `master`. Checked here: the script
type-checks (`bunx tsc -p e2e`), the workflow parses as YAML, its actions are pinned to the same
commits as `ci.yml`, tauri-driver 2.1.0 is the newest release on crates.io and msedgedriver-tool is
pinned to its newest commit (GitHub API, 2026-11-05). Unknown until it runs: whether WebKitWebDriver
under `xvfb-run` and msedgedriver from that tool match the runners' web views, whether the app
inherits the `XDG_*` folders through tauri-driver on Linux, and the selectors against the real
first screen. To try it on a Linux desktop: `cargo install tauri-driver --locked`, install
`webkit2gtk-driver`, `bunx tauri build --debug --no-bundle`, `bun run e2e:app`; it prints each step
and the one it stopped at. In GitHub: Actions → App end to end → Run workflow.

What CI checks, layer by layer: [testing.md](testing.md).

## Android build (`src-tauri/gen/android`, CI job `android`, T-042)

Never built: the Android SDK and NDK can't be downloaded here (Google's hosts are refused). The
project was generated with `tauri android init` against stand-in SDK, NDK and Java folders, so
the files are Tauri's template for this app, with Polarity's launcher icon (`tauri icon`) on a dark
background in place of Tauri's logo. Checked here: `src-tauri` type-checks and passes clippy for
`aarch64-linux-android` (zig standing in for the NDK's compiler; nothing linked), the updater and
process permissions now sit in `capabilities/desktop.json`, which mobile builds skip, and gilrs is
left out of phone builds (the Gamepad API still sees controllers). Unknown until the job runs:
Gradle 9.6 and the Android Gradle plugin 9.3 on Java 21, whether the runner image has the SDK
platform the project compiles against (the job installs it), and the APK itself. To try it on a
desktop with Android Studio: `bun run tauri android dev` with an emulator running, or download the
`android-debug-apk` artifact from a CI run and `adb install` it. On a phone, look for: the app opens
on the home screen, the phone layout and bottom tab bar, a title plays in `<video>` where the phone
can decode it.

## Android Back, keyboard, downloads, emulator run (T-043)

Built without running on Android: Back (button, gesture, a remote's Back) reaches the page through Tauri's
`onBackButtonPress` (`lib/platform/back.ts`), which takes Back over from the system; the page presses Escape where
focus is (`lib/ui/systemBack.ts`), so the top layer closes, then the player or pushed page; on a tab's own page Back
goes Home, and on Home it closes the app (`exit`, permission `core:app:allow-exit` in `capabilities/mobile.json`).
A focused text field loses focus first. Tested here: the decision (`tests/systemBack.test.ts`) and the Escape it
sends (`tests/dom/systemBack.test.ts`). Not known: whether the WebView also delivers KEYCODE_BACK to the page as a
key (it would go back twice), and the account screens before sign-in, which register no handler (the system's
default: the web view's history, else the app closes).
On-screen keyboard: from Android 15, edge to edge, the window no longer shrinks for it, so `MainActivity.kt` pads
the content view by the keyboard's height less the navigation bar's (never compiled here), and
`lib/ui/keyboard.ts` scrolls the focused field into view on each resize. Look for: a search field at the top and
the account forms near the bottom stay above the keyboard, with no gap or double padding.
Downloads stay in `app_data_dir/downloads` (app-private); "Show in Folder" is hidden off desktop.
Emulator: `e2e-app.yml` job `android` (nightly, `master`) builds the x86_64 debug APK and runs `e2e/android/smoke.sh`
in an API 35 emulator: start, 30 s alive, Back, no crash; logcat and screenshots as an artifact. Not run yet.
The Playwright suite isn't pointed at the app (it would need a WebDriver into the
WebView, chromedriver through adb); the screenshots are the check of what it shows.

## Android TV (same APK, T-047)

Written by reading only: the manifest's banner (`res/drawable-xhdpi/banner.png`, 320x180, the icon and
"Polarity" in Open Sans Bold) and touch screen not required, and `MainActivity.kt` adding a `polarDevice`
JavaScript interface before the first page loads, answering `isTv()` from `UiModeManager` (TV mode type) or the
`android.software.leanback` feature. The Kotlin was never compiled here. The front end's side is tested
(`detectTvDevice`, `startsInTvMode`). To check, in Android Studio start an Android TV emulator (API 34, 1080p) and
`adb install` the `android-debug-apk` artifact (x86_64). Look for: the banner in the launcher's apps row; the app
opening fullscreen in TV mode; the D-pad moving focus; Back closing the top layer, on the home screen opening the TV menu and, with the menu open there, leaving
the app; leaving TV mode from the TV menu lasting until the app is closed, and TV mode back at the next start. On
a phone, TV mode must stay off unless chosen. Fire TV: `UiModeManager` reports TV there too (untested).

## Android player: libmpv (T-044)

Never built or run here (no Android SDK or NDK). Type-checked with clippy for `aarch64-linux-android`; the
certificate bundle and the MediaCodec mapping are tested (`polar-player`: `certs`, `tune`); the build script's
source archive and `SOURCES.txt` steps were tried on a stand-in folder, its build steps weren't.
CI job `android` builds libmpv and FFmpeg with `scripts/android-mpv.sh` (mpv-android's build scripts, pinned
versions, about an hour the first time, then cached) and keeps `android-mpv-sources` (the sources archive) next to
the APK; the emulator smoke test fails if the APK carries libmpv and the app hasn't loaded it.
What to look for on a phone or the emulator, with the `android-debug-apk` artifact: the loading screen says
"Player: mpv"; an MKV with HEVC video and AC3 or DTS audio plays with picture and sound; ASS and PGS subtitles show;
the page's controls draw over the picture and the picture fills the screen behind them in both orientations;
Home and back to the app: the picture comes back (the surface is given back to mpv) and playback goes on;
an HTTPS stream plays (mbedTLS reads `cacert.pem`, made from `/system/etc/security/cacerts`); subtitles use
Roboto; hardware decoding (Settings → Advanced) on and off both play; autocrop (MediaCodec copied back) works;
a TV box with 2 GB of memory plays a 4K file (the cache is 64 MiB there). Not built: Picture in picture,
background audio, the media session (lock screen controls).
The same job builds an unsigned release APK and app bundle (`android-release-unsigned`), minified by R8:
`proguard-rules.pro` keeps `MpvSurface`'s native methods and `polarDevice`; check that a release build, signed with
any key for testing, starts and plays like the debug one.

## macOS release: sources of the bundled libraries

`scripts/macSources.ts` was tested only against a stand-in `brew` (`tests/macSources.test.ts`); Homebrew itself
never ran here. To check, on the Mac that makes releases, with `brew install mpv` up to date:
1. `bun scripts/bundle-libmpv.ts`, then `bun -e 'import { packMacSources } from "./scripts/macSources"; packMacSources("src-tauri/vendor/libmpv/formulae.json", "mpv-sources.tar", "mpv-sources-work")'`.
2. `tar -tf mpv-sources.tar` lists `SOURCES.txt`, one `recipes/<formula>.rb` per keg in `formulae.json`, and under
   `sources/` a source archive for each (plus resources and patches some formulae use, e.g. a `.patch` or `.diff`).
3. `SOURCES.txt`'s versions match `BUNDLED.txt`'s. If Homebrew has a newer version of any of them, step 1 stops
   and says which: `brew upgrade`, then build again.
4. A formula built with Rust or Go fetches its crates or modules while building, which `brew fetch` doesn't
   download: if `formulae.json` lists one, say so (those need adding by hand).

## Saving in the background (R4, H8/M4)

`polar.json` is now written by a background thread about a second after a change,
instead of by each command before it returns. The writer is tested in
`crates/library`; its wiring in `src-tauri` is read-only here.

1. Change a setting, add something to the library, play a few minutes; quit normally
   and start again: all of it is there. `polar.json` is one line now, with `"version":1`.
2. Same, but kill the process (Task Manager / `kill -9`) within a second of a change:
   that last change may be lost, nothing older, and the file still opens.
3. Install an update through the in-app updater right after a change: the relaunch
   may skip the exit hook that flushes; check the change survived (if not, the
   updater path needs a flush command before relaunch).
4. Make `polar.json` read-only (or fill the disk) and change a setting: the app should
   say it could not save (the error comes with the next change after the failed write).
5. Edit `"version"` to 2 and start: a `polar.v2-<time>.json` copy appears next to it.
6. Linux/macOS: `ls -l polar.json` shows `-rw-------` after the first change.

## Downloads: pause, resume and stalls (R4, H9)

1. Start a download, pause and resume it several times quickly while it runs; when it
   finishes, play it through to the end, seeking around: no glitches or broken spots.
   While it runs the downloads folder holds `<name>.part`; when done, only `<name>`.
2. Pull the network cable mid-download: within about 30 s it shows "The source stopped
   sending." and can be resumed.
3. A download paused with an older build resumes from where it was.

## Player start-up steps (T-022)

The loading screen now lists each step under the logo while a video starts, says
where it failed, and has **Copy Details**.

How to check (needs mpv installed, then again without it for the built-in player):

1. Play anything that works. Under the logo you should see, in order and with times:
   `Player: mpv`, `Asking your add-ons for sources`, `Found N sources from M add-ons`,
   `Source 1 of 5: …`, `Link: direct file (.mkv) on <host>`, `Contacting <host>`,
   redirects if any, `206 Partial Content from <host> · video/… · <size> · <time>`,
   `Handed to mpv, opening the file`, `Container: …`, `Tracks: …`, `File opened · … long`,
   `Buffering N%`, `Playing`. Only the last five lines show while loading.
2. A link that fails: `scripts/open-films-addon.ts` serves on 127.0.0.1, which is
   not checked (it says `Not checked: a server on this computer`). To see a failure,
   install an add-on whose stream answers 404 (or edit the script's URL to a missing
   file on a public host): the screen should say the 404, `Failed at the source's
   server`, show the whole log scrolling, and **Copy Details** should copy it.
3. Paste the copied text somewhere: it must hold no full links (only hosts in
   `<…>`), no add-on config, no tokens, no home folder, no LAN address.
4. Without mpv: the same steps come from the built-in player (it now runs the same
   link check first, `stream_probe`); an MKV should end with `Built-in player:
   format not supported` and the "needs mpv" message.
5. Watch party: a source that doesn't start in 20 s logs `Not playing after 20 s`.

Not covered: HLS playlists are checked like files (the first 1 KB of the playlist).

## Anime links and episode context (T-005 step 3)

Opening an anime page (desktop or TV) now records which id the entry plays from
(`link_anime`); library items and progress kept under its Kitsu id move onto its
IMDb id. What the page lines up per episode (absolute number, MAL and Kitsu ids,
filler) is kept in localStorage (`polar.animePlayContext.v1`) instead of memory.

How to check:

1. Open an anime with an IMDb page and several seasons, play episode 2 a minute, quit
   Polarity. Start it again and play episode 2 from Continue Watching without opening
   the anime page: AniSkip's opening skip should appear, and the source list should
   include anime add-ons that only know Kitsu ids.
2. Turn on "skip filler" and, after a restart, let a show with filler episodes
   autoplay from Continue Watching up to a filler run: it should be skipped.
3. A show watched under `kitsu:N` before (an older Polarity build, a Kitsu-only show
   that later got an IMDb page): open its anime page; the library entry and the
   watched marks should now show under the IMDb title, once, in Library, History and
   Continue Watching.
4. Opening the same anime page twice must not change `updatedAt` of its link
   (`anime_links` in the devtools console: `__TAURI_INTERNALS__.invoke("anime_links")`).

## Anime links through the account (T-005 step 5)

Signed-in profiles now sync their anime links through the new `anime_links` table
(`supabase/migrations/20261104000000_anime_links.sql`). The migration was run here
on PGlite (Postgres 17 in WebAssembly) after the first migration, with `auth.users`
and `auth.uid()` stubbed: older writes are ignored, newer ones win, alias ids and
AniList id 0 are refused, another user sees and writes nothing, deleting the
profile deletes its links. Not checked: a real Supabase project and two devices.

How to check:

1. Apply the migration to the project (`supabase db push`, or paste it into the SQL
   editor). In Table Editor, `anime_links` shows RLS enabled and one policy.
2. Device A, signed in: open an anime page. Within a few seconds a
   row for its AniList id appears in `anime_links`.
3. Device B, same profile, still holding that show's library entry or progress under
   `kitsu:N` (play it there once from an addon that lists it by Kitsu id before step
   2): after its next sync (focus the window), Library, History and Continue
   Watching show it once, under the IMDb title, without opening the anime page there.
4. A server without the migration: sync of library and progress must still work,
   with `sync failed` absent from the console. After applying the migration, the
   next sync sends every link the profile has (localStorage key
   `polar.animeLinksUnsent.v1` holds the profile id until then).

## Episode numbering with a TMDB key (T-005 step 6)

With a TMDB key, series episodes now carry IMDb's (Cinemeta's) season and episode
numbers: `crates/index/src/lib.rs` fetches Cinemeta's episode list next to TMDB's and
`polar_addon::numbering::renumber` matches them by air date (tested in
`crates/addon/src/numbering.rs`). `polar-index` does not compile on the dev machine
(T-012), so the wiring in `lib.rs` was checked by reading only.

How to check, with a TMDB key set in Settings:

1. Open a show TMDB splits into more seasons than IMDb (several long-running anime;
   check two). Seasons and episode numbers match the show's IMDb page; titles,
   stills and overviews are TMDB's.
2. Play an episode from season 2 or later: the addons find streams for that episode,
   not another one with the same TMDB numbers.
3. Progress saved before this change for such a show under TMDB's numbers stays under
   those ids: that episode shows as unwatched (not migrated; such progress could
   already point at the wrong episode for addons).
4. With Cinemeta unreachable the show still opens, with TMDB's numbers (log line
   `no IMDb numbering for tt…`).

## Compact account storage (T-010, T-027)

`supabase/migrations/20261105000000_compact_storage.sql` moves library and progress into
`library` and `progress` without any show information, keeps one progress entry per title, takes
keys and add-on links out of stored settings and drops the old tables (docs/supabase-storage.md).
Checked in PGlite (Postgres 17, `tests/sql/compactStorage.test.ts`, run by `bun run test` and on
every push in CI: every migration from empty, copy, codec in SQL and TypeScript alike, both
trigger modes, clamping, RLS between two users, anime links, playlist limit, the check script). Not checked: a real Supabase project, PostgREST's upsert through the trigger, and two
devices.

1. On a copy of the project run part 1 of `supabase/checks/compact_storage.sql`, apply the
   migration, run part 2: the counts must match, every other query returns 0 rows or 0.
2. Two devices signed in to one profile, both on this version: save a title and play an episode
   on one; after the other's next sync (focus its window) the title is in its Library and Continue
   Watching, with name and picture appearing once looked up. Library → Sort by Title works once
   names are in.
3. A device that had the titles before keeps its own names, pictures and every episode's position
   after pulling (only the newest episode per title is on the server).
4. Optional: run `supabase/optional/per_episode_progress.sql`, wait ten minutes (or restart both
   apps), play different episodes of one show on each: both keep both, with no setting on either.
   `per_episode_progress_off.sql` goes back the same way.
5. A version older than this one, signed in after the migration: library and progress no longer
   sync for it (expected, cut over at once); updating it pushes what it has.

## Settings sync without keys and add-on links (T-029, I-009)

Settings documents now carry only what a profile changed from the defaults (`settings_defaults`
command, not run here: src-tauri only type-checks), and keys and add-on links apart (#89). Tested here
as pure functions (`tests/settingsDoc.test.ts`, `tests/secrets.test.ts`); not run in the app.

1. Two devices, one profile: change Seek step on one; the other takes it after a sync. Set it back to
   the default on the first: the second goes back too.
2. #89: a TMDB key or an add-on added on one device appears on the other after a sync. Services and
   Add-ons pages and Settings → Account → API keys and addons say they're stored readable on the
   server; the Supabase table editor shows them in `profile_settings.data.secrets`.
3. #89: set a passphrase on the first device: `data` now has `sealed` and no `secrets`; the second
   device says "Locked" and asks for it, keeping its own keys meanwhile; a wrong one says it doesn't
   open them; the right one brings the keys. Change it on one device: the other asks again. Remove it
   (confirm): both show "Not encrypted" and `data.secrets` is back.
4. Sign out on a device that had its own keys and add-ons before signing in: they are back as they were.

## Sync leftovers: dirty set, per-key settings merge, playlists (T-053, R2)

Tested here: `crates/library` (`sync.rs` tests: pulled rows not sent back, an edit during a push, a
clock stepping back, a store from before the dirty set), `tests/spacePush.test.ts`,
`tests/settingsDoc.test.ts` (merge, first round, unknown keys, other passphrase),
`tests/playlistSpaces.test.ts` (newer-version playlists, the 100 limit), and in PGlite that a settings
write the server skips comes back with no row and a too-large one fails with 23514. Not run in the app or
against a real project.

1. Two devices, one profile, both offline: change Seek step on one and Subtitle size on the other, then
   go online. Both end with both changes (before, the later device's whole document won).
2. Add an add-on on a device signing in to an existing profile for the first time: it stays.
3. Update the app on a device that already had an account: the first round pushes only what changed since
   its last push before the update (no full re-upload); after that, a pull is not pushed back (Supabase
   logs: no library/progress upserts right after a pull with nothing changed here).
4. Watch something while offline with the clock set an hour back, then fix the clock and go online: the
   progress still goes up.
5. 100 playlists: New Playlist disappears from Library, the card menu, the title page and TV; delete one
   and it comes back.
6. Settings → Account says "too large to sync" only when add-on links push the document past the
   server's 16 KB; removing some makes it sync again without a restart.

## Platform layer (T-030, docs/ARCHITECTURE.md)

- Window, updates and native events now go through `src/lib/platform` (built and type-checked here, never run in
  the shell). To check on a desktop: the window buttons (Windows) minimise, maximise and close; F in the player and
  TV mode go fullscreen and back; Settings → Interface size still zooms; with a controller plugged in at launch the
  "connected" toast shows; the player's loading screen lists its steps and Copy details says the right system
  (Windows / macOS / Linux); Settings → About → Check for updates still answers.
- Linux: `mpv_available` is now false there (mpv can't draw into a GTK window), so the player always says
  "Player: built-in". Before, an mpv on PATH made it pick mpv and fail with "isn't supported on this system yet".
  To check: on Linux with mpv installed, play anything that `<video>` can play (MP4/H.264).
- Apple TV: docs/ARCHITECTURE.md §3 says tvOS has no web view and Tauri 2 doesn't target it (from Tauri's list of
  supported platforms: Windows, macOS, Linux, Android, iOS). Check before planning cycle 3.

- Narrower web view policy (R4 M2/M20): `connect-src` now names its hosts and `opener:default` is gone. Checked
  here only by `tests/webviewPolicy.test.ts`, which reads the code for the hosts it fetches. To check on a desktop:
  open the devtools console (right-click → Inspect in a debug build) and look for "Refused to connect" while you
  sign in, start a Watch Party (Supabase realtime over `wss://`), open Anime and an anime title (AniList, ani.zip),
  play an anime episode with skip times (AniSkip), open Discover's add-on list, and run Check for updates. Links
  (Trailer → YouTube, Credits) must still open in the browser and Downloads → Show in folder still reveal the file.
  A self-hosted Supabase (not `*.supabase.co`) is refused until its host is added to `connect-src`.

## Add-on request headers on playback (R4 M19)

- mpv now gets the stream's User-Agent/Referer/Origin from `behaviorHints.proxyHeaders.request` as
  `http-header-fields`, set by `set_property` with a JSON list before each `loadfile`. Tested here: which headers
  pass (`crates/player/src/headers.rs`) and that the link check sends them through a redirect (`probe.rs`
  `sends_the_addons_headers_on_every_hop`). Not run: mpv itself. To check on Windows or macOS: install an add-on
  whose streams carry `proxyHeaders` (or serve one from `scripts/open-films-addon.ts` with a Referer check on the
  file server); before this change it downloaded but failed with "The source answered 403", now it plays. Then play
  a normal source with an external subtitle to see no header is left over.
- A source that needs a Cookie or Authorization header still fails to play (only downloads send those); on Linux
  the built-in player can't send any header.

## Log file (R4 M14)

- The rotation (`crates/library/src/logfile.rs`) is tested here; the app's wiring (`src-tauri/src/logging.rs`) is
  only type-checked. To check on a desktop: start Polarity, then open the log folder the README names; `polar.log`
  starts with "Polarity <version> starting". Remove the MDBList key's last letter and open a title: a "ratings
  from api.mdblist.com failed" line appears without the key in it. Search the file for your keys and add-on links:
  none should be there.
- The Linux path assumes Tauri's `app_log_dir` is `~/.local/share/<identifier>/logs`; check it once on Linux.

## Name and sign-in session in the keychain

- The name is Polarity in the installer (`productName`), README, the log's first line, the User-Agent
  (`polarity/<version>`) and the UI; the app id `app.getpolar.desktop` stays, so data, log and web view folders
  don't move. Not seen: whether the Windows installer of "Polarity" upgrades an installed "Polar" in place or
  installs beside it (NSIS keys its folder by product name), and the macOS bundle now being `Polarity.app`.
- The session's layout in the keychain (`crates/library/src/keychain.rs`, split into chunks under Windows'
  limit, a failed write keeps the old value) and the web view's side (`src/lib/platform/keychain.ts`: move on
  first start, fall back, read once per run) are tested here. `src-tauri/src/keychain.rs` over `keyring` 4 is
  only type-checked (Linux and Windows); no keychain was touched on this machine. To check on each system:
  sign in, quit, start again: still signed in, and an entry under `app.getpolar.desktop` is in Keychain Access
  (macOS), Credential Manager (Windows) or Seahorse/KWallet (Linux). Signed in with an older build, the first
  start of this one keeps you signed in and moves the session there. On Linux without a Secret Service, sign-in
  still works and is kept by the app itself. Sign out: the entries are gone.
- Phones: no keyring store is wired yet (`keyring` isn't built for Android/iOS); the session stays in the web
  view's storage there.

## Phone and tablet layouts (T-033)

- The layouts were first checked by reading the CSS, and the form-factor rules by tests
  (tests/formFactor.test.ts); since T-051 they have been seen at 390×844 in a headless Chromium with an iPhone
  user agent (next section). Nothing here has been seen on a real phone or tablet: the mobile shells don't
  exist yet (cycle 3).
- To check on Windows now (the app only starts in its shell): `bun run app`, open DevTools in the window
  (right-click → Inspect), turn on device emulation (Ctrl+Shift+M) as a Pixel or iPhone and reload: the user
  agent makes it a phone. Look for: the tabs in a bar along the bottom,
  More taking what doesn't fit; Back, search and the profile at the top; the last row of each page clear of the
  tab bar; the home hero's text across the card with Next at its top right; a show's episode list with the
  number above the title; no window buttons. As an iPad: the desktop layout with 44 px bar icons.
- A desktop window narrower than 600 px now gets the hero and episode-list changes too (not the tab bar).
- Touch: a tap on the playing video shows or hides the controls whatever "Clicking the video" says.

## Screens, player and engine after R5 (T-008)

- Player: the clock, skip button, Up Next and the 75 % prefetch now follow the playhead through
  `useMediaTime` instead of re-rendering the whole player four times a second. Seen working here in headless
  Chromium with the built-in player (the fake shell's links answered by a test file): the clock ticks, ← / →
  seek, Space pauses and the clock stops, clicking the clock cycles remaining / elapsed / ends at, Sources opens,
  Esc leaves; on a series Up Next appears in the last 40 s and the next episode starts by itself after the
  countdown. Not seen: mpv (Windows, macOS), where time comes from mpv's reports. To check on a desktop: play an
  episode, watch the clock and scrubber for a minute (smooth, no jumps), let it reach the credits (Up Next), and
  open each panel while it plays.
- Screens load their own code the first time they open: the player (fetched once the app is idle), TV mode,
  Settings, sign-in and profiles, an anime's page, and the avatar art. All seen opening in Chromium except
  sign-in and profiles (no account there). To check in the app: sign out and in, switch to TV mode, open
  Settings, an anime and a profile menu; each should appear at once, without a blank frame.
- Library: Saved, Watched, Playlists and Downloads, and each playlist, are pages of their own: Esc and the
  mouse's back button step out one page (seen in Chromium). A new playlist still opens with its name selected.
- Accessibility: with "Show titles" off, cards keep their title as their name for screen readers; the season
  picker, episode ranges and anime schedule days are radio groups. Not checked with a screen reader: try
  Narrator or VoiceOver on a title page and the nav tabs (Enter and Space open a tab).
- mpv engine (only type-checked): closing the app while mpv is busy now kills mpv; if mpv exits, waiting calls
  fail at once instead of after 5 s; autocrop stops when mpv shuts down after being idle; frame snapshots for
  the blurred overlays use their own file each. To check on Windows: play something, quit the app from the tray
  or Alt+F4 mid-load, and see that no `mpv.exe` stays in Task Manager. If the app itself crashes, mpv can still
  be left running (no Windows Job Object yet, T-052).
- The link check gives up after 25 s in all and lets the player try the link (tested here against a slow
  local server). Subtitles in UTF-16 or Windows-1252 now show their accents and curly quotes (tested); an
  add-on subtitle without a language is listed as "Unknown language".
- Shortcuts synced between a Mac and a PC: Ctrl+K set on Windows arrives as ⌘K on the Mac. Tested as functions
  only; check by changing a ⌘ shortcut on one machine and looking at Settings → Controls on the other.

## Eased autocrop moves (docs/autocrop.md §6)

- `crop::CropZoom` and `CropTracker::on_cut` are tested in `crates/player`; their wiring in
  `src-tauri/src/player/autocrop.rs` only type-checks here (no mpv, no WebKitGTK). Unknown: whether mpv shows
  a `video-zoom` sent on every frame smoothly (no dropped or doubled steps), and whether a jump lands on the
  cut frame itself, with `--video-sync=display-resample` and without. To check: play a film with bars that change
  mid-shot on the desktop build and watch the crop settle.

## Autocrop pre-roll probe (docs/autocrop.md §3)

- `crop::opening_points`, `crop::opening_bars`, `CropTracker::open`, the PNG reader (`polar_player::png`) and
  the detector on RGB screenshots are tested in `crates/player`; the probe itself
  (`src-tauri/src/player/preroll.rs`) and its wiring in `mpv_load` and the autocrop loop only type-check here
  (no mpv binary may run on this machine). Unknown, to check on the Windows build with autocrop on:
  - that `screenshot-to-file … video` works with `--vo=null --screenshot-sw=yes` and writes a PNG with stored
    (uncompressed) data at `--screenshot-png-compression=0` (if not, the probe finds nothing and playback starts
    uncropped, as before: no harm, but no gain);
  - how many of the 8 keyframes arrive within the 1.5 s budget on a typical stream (log line
    `autocrop pre-roll: N readings` at debug level), and that a scope film's first frame is already cropped;
  - that the probe's mpv is gone after each load (Task Manager) and its `probe-N` folder removed;
  - HDR: whether software screenshots of PQ video are tone-mapped enough for the HDR levels to read the bars.
- macOS has no probe yet (libmpv in the app, no second instance): films start uncropped there, as before.

## Autocrop lookahead (docs/autocrop.md §4)

- `lookahead::Schedule` and its hand-over to `CropTracker::cut` are tested in `crates/player`; the engine side
  (`preroll::ahead`, a second probe that follows the playhead, and `take` per frame in the autocrop loop) only
  type-checks here. To check on the Windows build with autocrop and "Look ahead for bar changes" on:
  - that the probe's `seek 0.1 relative+keyframes` (doubled while it lands on the same keyframe) steps keyframe
    by keyframe, and stays about 60 s ahead of the playhead (a scope film with an IMAX sequence: the crop
    should jump on the cut frame into and out of it);
  - frame-exact landing, with `--video-sync=display-resample` and without (§4);
  - that it starts again after a seek back, a seek forward and a pause; that its mpv (`ahead-N`) is gone after
    the next load, after switching it off, and when the app closes;
  - cost, 10 minutes each on a 10 Mbit/s MKV and an HLS stream: extra bytes (the probe's `raw-input-rate`),
    the probe's CPU time against playback alone. Then the defaults per device (§7).
- Switching the lookahead on mid-file takes effect from the next file; macOS has no lookahead (no probe).

## Our autocrop detector on the desktop (docs/autocrop.md §2)

- `sampler::Sampler` (which reading feeds the tracker, when to take a screenshot) is tested in `crates/player`;
  the engine side (`take_shot` in `src-tauri/src/player/autocrop.rs`) type-checks for Linux and Windows here,
  and the macOS side (`polar_mpv_frame` in `src-tauri/src/macos/mpv_view.m`, `mac::Frames`) builds only on CI's
  macOS runner. To check with autocrop on, on a scope film with bars changing (an IMAX sequence) and a film
  that moves its own bars:
  - Windows, default: the log's `autocrop:` lines show screenshots only around changes (none on a still
    letterbox); a change of bars lands within a frame or two of its cut; moving bars are followed frame by
    frame. Check that `screenshot-to-file … video` is the frame unzoomed (with the crop applied, our readings
    still find the bars rather than full frame).
  - Windows, "Check every frame for black bars" on: the log's screenshots per second and MB/s written, and mpv's
    and Polarity's CPU in Task Manager against autocrop with the setting off, on a 1080p and a 4K file. Put
    the numbers in docs/autocrop.md §2 and the setting's caption.
  - macOS: every frame read in memory (`screenshot-raw video` through a weak client): the log's screenshots per
    second (no MB written), CPU against autocrop off; a change lands within a frame or two of its cut; nothing
    hangs when playback stops or the window hides mid-read; hardware decoding stays zero-copy.

## Seasons as separate shows (#22)

Checked here: unit tests (`tests/animeEntries.test.ts`) and an end-to-end test of Continue Watching
on the fake backend. AniList can't be reached here, so with the setting on, check in the app:
- Anime page, search and Browse: a show with several seasons shows a card for each; off again, one.
- An entry's page: no season tabs, only its episodes; its prequel and sequel under Related.
- Watch an episode of a second season from its page, then Home: Continue Watching shows that
  season's name and poster and "Episode N"; it opens that season's page. Library and Watched too.
- TV mode: the same cards; a card opens the show's page with only that season's episodes.
- Switching the setting off and on loses no progress or library items.

## Screens in headless Chromium (T-051)

- How: `bun run dev`, then open `http://localhost:1420/fake.html` in any browser. The
  fake shell (src/fake-main.ts, src/lib/platform/fake) answers every command from made-up titles; nothing is
  fetched and nothing plays. `?theme=black` and other settings go in the query string; TV mode is
  `localStorage.setItem("polar.tvMode", "1")` in the console, then reload.
- Seen and fixed: every desktop screen (home, Series, Movies, Anime, Library, search, a show, a film, the
  player's start-up screen, the profile menu, every Settings page) at 1440×900 in dark and black; the same at
  390×844 as a phone; TV mode at 1920×1080 (home, each tab, a title, its Episodes, search, the menu, Settings,
  the player), plus a library collection, the Calendar, a card's menu and the player's panels. Fixes:
  c395bfb, aa68e5e (Settings on a phone), 314ea46, de8af47, e31623c.
- What Chromium can't stand in for:
  - The app's own windows. Chromium is close to WebView2 (Windows) but not to WebKitGTK (Linux) or WKWebView
    (macOS): look at `backdrop-filter` glass (navbar, menus, the TV menu), `field-sizing` in the Settings
    number boxes (in WebKit the box may be wider), `text-wrap: balance` in captions, `100dvh` on a phone, and
    the custom scrollbars. On each OS, open Settings → Sources and check "Any size" fits its box.
  - Real artwork, logos and long names: the fixtures are flat colours with short titles. Look at a show with a
    long name on a phone (player title, cards) and at title logos on the TV home.
  - Anime: AniList can't be reached from the fake shell, so the Anime screens only showed their error state.
  - Playback: the player only showed its start-up screen with a failure; the playing controls, Up Next, skip
    buttons, subtitles and the options panels over a playing video were not seen.
  - Fonts: Segoe UI and the system fonts of each OS aren't on this machine.
  - Account and Watch Party: the fake shell has no account, so sign-in, profiles, sync notices and the party
    dialogs were not seen at any size. The library collections, Calendar (empty), card menus and the
    player's Sources and Subtitles & Audio panels were.
  - TV on a TV: walked by arrow keys in the browser, not with a remote or a controller, and not at 4K or
    with overscan.
  - Phones: touch scrolling, the on-screen keyboard over Settings fields, notches and the home indicator
    (safe areas are 0 in Chromium).

## Earlier items

- Settings → About → Cache and Credits cards (TMDB logo 12 px under the notice): look only.
- Trailers: Detail/TV backdrop plays IMDb video files only; the trailer dialog prefers TMDB's YouTube id.
- Removed playback path (T-014): `src-tauri` edits checked by reading only; the old saved setting for the
  removed playback server is ignored on load, and `sourceSort: "peers"` falls back to best.
- UI clean-up (T-019 step 1): profile set-up and profile editor forms rise 8 px and fade in again
  (`auth-form-in` had been renamed away in 1215be7, so they appeared without it). Dead CSS removed by
  grep only (no class built at runtime matched); look for any unstyled About/Library/sign-in element.
- Title right-click menu and profile menu: the highlighted row now follows Settings → Appearance → Accent
  (was the OS accent via `AccentColor`); check the text stays readable on a yellow/teal accent.
- Token pass (T-019 step 2): every replaced literal resolves to the same value (checked by substituting the
  tokens back and diffing all CSS). Only with Windows "high contrast"/`prefers-contrast: more` on: two
  borders that used the hairline colour as a literal (a sign-in form border in `account.css` and a row
  border in the player's options panel) now strengthen with the other hairlines.
- Search fields (T-019 step 3, `SearchField`): the boxes are the same rules under new classes (checked by
  reading). Changed on purpose: every field shows the app's round clear button once it has text (new in
  Settings → Shortcuts, the anime episode search and the source-filter searches; the episode search loses
  the system's own clear "x"), and Escape first empties a field with text before it closes the sheet or
  overlay around it (new in Marketplace, Anime → Browse, the episode and source-filter searches). Check
  the clear button fits in the small source-filter field (9.5 rem wide).
- Primitives Skeleton, Toast, Menu, Popover (T-019 step 3): same rules under new class names (built CSS
  compared). Worth a glance: the controller and update toasts, the title right-click menu with its playlist
  submenu, the download menu, the profile menu and the navbar's "More". Open question for the owner's eye:
  the playlist popover (dark glass) and the source-filter popover (frosted, like the season list) still
  draw different surfaces; say whether they should become one.
- Escape (T-019 step 3, `lib/ui/dismiss.ts`): sheets and the trailer close on Escape through one stack now.
  Before, a sheet closed before anything inside it saw the key, so the "Escape empties the field first"
  above did not work in the episode and source-filter searches; now it should. Check, with a sources sheet
  open: Escape with the Filters popover open closes only the popover; with text in a source-filter search
  it clears the text; a second Escape closes the sheet; a third goes Back. Same for the trailer over a page.
- Poster grids (T-019 step 4, `PosterGrid`): Movies, Series and Anime → Browse used to ask for the next
  page only once the end of the grid was on screen, though the code meant 1200 px before it (the margin was
  measured from the window, and the page scrolls in its own box, which clips it). It now counts from that
  box, so the next page should arrive before you reach the bottom: scroll Movies → Trending quickly and the
  skeleton row should rarely be seen. Library grids are the same rules (built CSS compared).
- Title cards (T-019 step 4, `components/title/Card.tsx`): the poster, landscape, anime, Continue Watching and
  Library download cards are one component with the same elements and classes as before. Changes on purpose:
  art that fails to load is now hidden on every card (only posters did that before; elsewhere WebKit may
  have drawn a broken-image mark), and a download whose thumbnail fails shows the grey still placeholder.
  Check: Home's shelves and Continue Watching (resume button, Enter on a focused card opens the page),
  Anime's shelves with a manga in a franchise (badge, tooltip), Library → Downloads shelf, hidden captions
  in Settings → Browsing.
- Add to playlist (T-019 step 4, `components/title/PlaylistChecklist.tsx`): the card menu's Playlists submenu,
  the detail page's playlist popover and TV's playlist panel now share one list. Check in each: tick and
  untick a playlist (counts change), New Playlist (desktop menu: made at once as "New Playlist", "New
  Playlist 2", ...; popover: asks a name, Esc closes the form only; TV: on-screen keyboard). Changed on
  purpose: when the popover closes with the name form open, the form stays during the closing fade.
- Anime page split (T-019 step 4, `components/anime/`, 440eff9): no change meant; same elements and classes,
  the play model moved to `lib/anime/episodes.ts` with tests. Check on an airing show with several seasons
  (season tabs, next-episode line, Play label resumes where you left off, filler switch, list layout "Show
  all", episode search on a 40+ episode show), a film, and the Details section next to a show's Details tab
  (Story, Tags, Watch Officially, Elsewhere, the facts column beside them).
- Focus in sheets and the trailer (T-019, `lib/ui/layer.ts`): a sources or Filters sheet and the trailer now take
  focus when they open, keep Tab inside, and give focus back when they close. Check with the keyboard: open
  Sources from a show's Play button with Enter, press Tab several times (focus stays in the sheet and wraps),
  Shift+Tab from the first control goes to the last, Escape closes it and focus is on the Play button again;
  open the source Filters popover inside the sheet and Tab there (the popover should behave as before); the
  same with the trailer (Tab stays on its buttons; inside the YouTube player Tab is YouTube's own). No focus
  ring should appear on the sheet or trailer box itself.
- Settings from one schema (T-019 step 5, `lib/settings/schema.ts`): about 35 rows on desktop and every
  row in TV settings are now drawn from it. Desktop should look and behave as before; check the Playback,
  Sources, Browsing, Anime, Controls & TV and Controller pages (titles, captions, dropdown choices, the
  Countdown and Sound volume sliders, Crop black bars greyed out without mpv, a click when Interface sounds
  turns on). Changed on purpose: Highest quality also offers 1440p; desktop and TV share choices. On TV,
  check: Mature Anime has Show / Blur posters / Hide; Highest Quality adds 480p; Seek Step goes 1, 5, 10 ...
  120 (and keeps a value like 7 set on desktop); Sound Volume 5%, 10%, 20% ... 100%; choice names now read as
  on desktop ("Best match", "Out of ten (8.6)", "Default" audio); changing a Sources row refreshes the source
  list. Settings search: "with sound", "filler", "marketplace" now lead to a row (each used to land on the
  page with nothing highlighted).
- One Settings UI (T-019 step 5, M26): the old full-page Settings is gone. On a title with every source hidden
  by filters, "Source Filters" opens the settings window on Sources over the page (it used to replace the
  page); with no sources, "Manage Add-ons" opens it on Add-ons. On TV the same buttons open TV settings, now
  straight on Sources for "Source Filters" (Back goes to the category list); "Manage Add-ons" lands on the
  list as before. Switching from TV to desktop (the TV toggle shortcut) while on TV settings should open the
  settings window on desktop with the previous screen under it, or Home.
- Player options and TV Back (T-019 step 6, `lib/ui/dismiss.ts`, `lib/ui/layer.ts`): the player's full-window
  picker (Speed, Subtitles & Audio, Episodes, Sources, Party) closes on Escape through the shared stack, keeps
  Tab inside, and gives focus back to what had it when it opened. TV's panels and card menu are on the same
  stack (TV's own Back stack is gone). Check on desktop: open Sources with its button, Tab several times (focus
  stays in the picker), Escape closes it and the Sources button has focus again (Space then still plays or
  pauses, nothing reopens); with the source size slider focused, Escape closes the picker; with a filter
  dropdown open, Escape closes only the dropdown. On TV: B over the picker closes it; B in a title's Playlists
  panel goes back to the menu, then the card; Backspace does the same; the back sound plays once each time.
  Changed on purpose: on TV, closing a sources sheet or the trailer with B now also plays the back sound.
- Notes in the player (T-019 step 6): the top note ("That source didn't load. Trying the next best one."), the party's "Waiting for…" pill and its
  activity notes still draw their own pills (flat dark surface), unlike the app's toasts (glass with an edge).
  Say whether they should look like the toasts; nothing changed.
- TV cards (T-019 step 6, `useCardArt`): a TV card whose picture failed showed the title instead for good; now a
  new picture for the same card (a playlist entry that was still loading, better art) is tried again. Check a
  TV playlist rail right after start-up: cards fill in with art, none stays on the plain title unless the
  picture really is missing.
- Account screens on `Button`/`TextField` (T-024): sign in (`size="block"`, `variant="accent"`, `TextField
  look="block"`) and the profile screens' actions (`size="sm"`, `variant="outline"`/`"danger"`) keep their rules
  (checked by reading the cascade). Changed on purpose, to make the account screens one look: the profile
  set-up's name field and Continue button take the sign-in field and button (44 px, pill button with the
  accent, quiet border with a soft ring on focus; were 52 px field with a white focus ring and a 48 px square
  button), and the profile editor's name field takes the same border and focus (keeps its large type). Check
  sign in (both steps, the code step's paste, a wrong code), profile set-up, Manage Profiles, edit, delete.
- Error boundaries (rewrite R1, critique C4): a page, the player and the whole app each show "Something went
  wrong here." with a way out (Reload; Back in the player) instead of a blank window. No test can make a render
  fail here (no DOM in `bun test`). To check: open Movies
  with Genre = Horror and Catalog = Popular after searching "horror" (the old crash, now fixed by
  `lib/net/queryKeys.ts`, so the page must simply work), and for the note itself temporarily add
  `throw new Error("x")` to the top of `screens/Calendar.tsx`'s component, open Calendar: the note shows in
  the page with the nav still working; on TV the note takes the TV look and its Reload must be reachable with
  the controller.
- Saved data that can't be read (rewrite R1, critique C1; `src-tauri` store.rs/downloads.rs, built by reading
  only): only a missing `polar.json`/`downloads.json` starts fresh now. Any other read error leaves the file
  alone for the session (nothing is saved over it; actions that save report "could not save") and a toast says
  so with the reason; a damaged file is copied aside as before, and if that copy fails nothing is saved
  either. The decision is `polar_library::opened` (tested). To check: quit Polarity, make `polar.json` in the app
  data folder unreadable (`chmod 000 polar.json` on Linux/macOS; on Windows deny Read in its Security tab),
  start Polarity: the toast shows, adding a title fails, and after quitting and restoring the permission the
  file still holds the old library. Then put `{` into a copy of the file: a `polar.corrupt-….json` appears
  and the app starts empty.
- Sign-out with unsynced changes (rewrite R1, critique C2): sign-out now pushes every profile of the account
  (not only the active one) for up to 8 s, then counts what is still unpushed; if anything is, nothing is
  dropped and a dialog ("Some changes haven't synced") offers Try Again, Sign Out Anyway and Cancel. Each sync
  round of the active profile also pushes the other profiles' leftovers (a profile left while offline). The
  pushing and counting are `lib/account/spacePush.ts` (tested); the dialog and the wiring are not. Since M12
  (below) sign-out forgets playlists too, so every profile's changed playlists are pushed and counted as well
  (`playlistChanges(space)`, tested); links a server without the `anime_links` table can't take are not counted. To check, signed in with two profiles: in profile A
  add a title to the library, then turn the network off and switch to profile B, play something for a minute,
  then Sign Out (profile menu): the dialog shows a count; Cancel keeps you signed in; turn the network on,
  Try Again signs out; sign back in on another device: both changes are there. Repeat offline and choose Sign
  Out Anyway: you are signed out. The dialog also opens from the "Who's watching?" screen's Sign Out; on TV
  check that the controller can reach its three buttons.
- AniList and ani.zip request budget (rewrite R3, critique M10; `lib/net/limiter.ts`, tested with a fake
  clock): every AniList request now shares one budget (10 at once, then 20 a minute, raised to the limit
  AniList reports in `X-RateLimit-Limit` less 10 if the webview may read that header), ani.zip another (20,
  then 120 a minute). A 429 holds all requests to that host for its Retry-After (at most 60 s for AniList,
  30 s for ani.zip, 60 s/5 s when absent) and is retried once. Every ani.zip lookup now goes through the query
  cache (one request per show, shared by search, AniSkip, Kitsu titles, the stream filter and TV), and a query
  nobody needs any more stops waiting. Neither host is reachable from the dev machine. To check: open Anime,
  then a long franchise (more than ten entries): the seasons row still fills (more slowly past 10 hops: about one
  hop every 3 s while AniList is at 30 a minute); scroll every genre shelf; no "AniList answered 429" error
  appears. In the dev tools' Network tab, opening the same anime twice asks ani.zip once.
- Watch-party message checks (rewrite R3, critique M11; `lib/party/messages.ts`, tested): every broadcast and
  presence entry is parsed before use; malformed ones are dropped silently. A timeline more than 50 versions
  ahead is taken only from the host, so a member who was offline catches up from the host's heartbeat (within
  10 s). Not run against a real room. To check, with two signed-in devices: start a party on one, join by code on
  the other within 8 s; pause, resume, seek and change episode from both sides; turn one device's network off for
  a minute, change things on the other, turn it back on: within about 10 s both show the same state again.
- What a signed-out device keeps (rewrite R3, critique M12): sign-out and account deletion now also remove every
  profile's playlists, its cached synced settings, the remembered last profile and the recent searches (my call:
  they were global and showed the last person's searches to the next). Deleting a profile removes its playlists
  too. A guest's playlists are copied into the first profile with the library (`importLocalPlaylists`, tested).
  The device's own settings, addons, shortcuts and synced preferences are kept aside when a profile is first
  entered and put back at sign-out (`keepDeviceSettings`/`restoreDeviceSettings`, `polar.settingsOwner`; wiring
  untested). Signed in when updating to this version: no device copy exists yet, so the first sign-out leaves
  the profile's settings in place, as before. To check: as a guest, make a playlist and set the subtitle size
  and an addon; sign up: the profile has the playlist and those settings; change subtitle size and remove the
  addon; sign out: the guest's subtitle size and addon are back, the playlist list is the guest's, the search
  box shows no recent searches, and `localStorage` (devtools) has no `polar.playlists.<profile id>` or
  `polar.settingsSync.<profile id>` keys.
- Rust/TS field-name contract (rewrite R3, critique M5): `contract/addon.json` and `contract/library.json` were
  written by the crates' own tests; `contract/app.json` was written by hand from `src-tauri`'s types, and its test
  (`src-tauri/src/contract.rs`, a child of `commands.rs`) has never compiled. To check: `cargo test -p polar`
  on a desktop (CI's `cargo test --workspace` runs it). If it fails, it prints what `contract/app.json` should
  read: paste that in, then run `bun run test`; a failing `tests/contract.test.ts` names the TS type to fix in
  `src/lib/types.ts` (and `src/lib/contract.ts`).
- Command errors as `{ code, message }` (rewrite R3, critique L1; `src-tauri` built by reading only): every
  failure the app shows should still read as a sentence, never `[object Object]`. To check: install an addon from
  a URL that doesn't exist (Settings → Addons: the message names the network problem); open a title whose addon
  is gone; start a download of a source that plays in a browser ("can't be downloaded"); play a source that answers
  404 (the loading screen says `Failed at the source's server`) and, with mpv missing from its folder, any source
  (`Failed at the player`). Signed in with 5 profiles, adding a sixth says "An account can have up to 5 profiles."
- Account limits (#110; supabase/migrations/20261107000000_account_limits.sql, tested in PGlite:
  tests/sql/accountLimits.test.ts). Not run on a real project. To check on a copy (docs/supabase-storage.md
  §7, §8): apply the migration, run `supabase/checks/account_limits.sql` (every count 0, then the
  validations go through) and `supabase/admin/account_usage.sql`; sign in and sync as usual (nothing
  changes below the caps). The "Your account is full" toast (`AccountFullToast`) and syncing the other
  kinds while one is full are tested in parts (spacePush, dbError), not in the running app.
- CAPTCHA on sign-in (#110; `lib/account/captcha.ts`, `screens/account/Captcha.tsx`): never shown, since
  no site key exists yet. Unverified: whether Turnstile's widget loads and passes in the app's web view
  on each platform (pages come from `tauri://localhost` on macOS, Linux and iOS and
  `http://tauri.localhost` on Windows and Android; the CSP allows `https://challenges.cloudflare.com`
  as script and frame), and whether Supabase also asks for a CAPTCHA when the code is entered (the app
  sends one only with the request for a code). To check, on each platform with a build carrying
  `VITE_CAPTCHA_SITE_KEY` and CAPTCHA on in a test project: ask for a code: the check shows under the
  button, and once passed the code is sent; enter the code: signed in. With CAPTCHA off: no check shows.
- `polar.json` renamed `polarity.json` (#40; `polar_library::moved::take_over_or_keep`, tested on Linux): at
  the first start of this version the file is copied to `polarity.json` (owner-only on Linux and macOS), then
  the old one renamed `polar.json.moved`. If the copy can't be made, `polar.json` stays in use and the next start
  tries again. The log (`polar.log`) and the `app.getpolar.desktop` folders keep their names. To check on each
  desktop: with a library and settings from the previous version, start this one: everything is there, the app
  data folder has `polarity.json` and `polar.json.moved` and no `polar.json`; change a setting, quit, start
  again: still changed. An earlier version started after this one finds no `polar.json` and starts empty
  (rename `polar.json.moved` back to go back).
- Add-ons and API keys per profile on a device (#80; `startProfile`, `setupSources`, `copySetup` in
  `lib/account/settingsSync.ts`, tested with the mocked store). Settings → Account → Sync → "Share add-ons and keys
  between profiles on this device": on for installs from before this version (prefs or an account's settings
  already stored), off for new ones. Off, a profile this device has never synced starts without the add-ons and
  keys in the store (only the app's own subtitles add-on stays), takes its account's own on the first sync round,
  and sends nobody else's up; while it has none, Settings → Account offers "From Guest on this device" and the
  account's other profiles synced here. Not run signed in. To check, with sharing off: as a guest add a TMDB key
  and an add-on; sign in to a new account: no key, no add-on, and the offer lists Guest; copy: both there; sign
  out: the guest's set as it was; sign in to a second account: it never sees the first account's set.
- AniList requests by priority, rows kept on the device (#109; `lib/net/limiter.ts`, `lib/net/deviceCache.ts`,
  tested with a fake clock and a fake AniList). Not run against AniList. To check, with devtools' Network filtered to
  `anilist`: scroll the Anime page to the genre rows; rows on screen fill within a few seconds even while AniList
  answers `X-RateLimit-Limit: 30`, and then each row is one request. Open a card while rows are still loading: its
  page doesn't wait behind them. After a 429, loading shelves say "AniList is busy, loading…". Quit and start again:
  the Anime page draws its rows at once. Settings → About → Cache → Clear empties them.
