# What could not be checked on the dev machine

The work on this branch was done on a Linux VM with no display, no WebKitGTK and no
mpv. `tsc`, `vite build`, `bun run test` and `cargo test` for `polar-addon`,
`polar-anime` and `polar-library` run there; `src-tauri` does not build there, and
nothing could be looked at on screen. This file lists what still needs a person
with the app, and how to check each item. It grows as work lands (T-011 finishes it).

## Built by reading only (`src-tauri`)

`src-tauri` was checked with `rustfmt`, by reading and, from R4 on, with `cargo clippy
--all-targets` against stub system libraries (it type-checks; it can't link or run here).
`cargo build` / `bun tauri dev` on a desktop is the first check for every item below.

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
   Polar. Start it again and play episode 2 from Continue Watching without opening
   the anime page: AniSkip's opening skip should appear, and the source list should
   include anime add-ons that only know Kitsu ids.
2. Turn on "skip filler" and, after a restart, let a show with filler episodes
   autoplay from Continue Watching up to a filler run: it should be skipped.
3. A show watched under `kitsu:N` before (an older Polar build, a Kitsu-only show
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
Checked here in PGlite (Postgres 17, `work/tmp/pgcheck/compact.ts`, 29 checks: copy, codec in SQL
and TypeScript alike, both trigger modes, clamping, RLS between two users, playlist limit, the
check script). Not checked: a real Supabase project, PostgREST's upsert through the trigger, and two
devices.

1. On a copy of the project run part 1 of `supabase/checks/compact_storage.sql`, apply the
   migration, run part 2: the counts must match, every other query returns 0 rows or 0.
2. Two devices signed in to one profile, both on this version: save a title and play an episode
   on one; after the other's next sync (focus its window) the title is in its Library and Continue
   Watching, with name and picture appearing once looked up. Library → Sort by Title works once
   names are in.
3. A device that had the titles before keeps its own names, pictures and every episode's position
   after pulling (only the newest episode per title is on the server).
4. Optional: run `supabase/optional/per_episode_progress.sql`, turn on Settings → Account → Sync
   every episode on both devices, play different episodes of one show on each: both keep both.
   `per_episode_progress_off.sql` goes back.
5. A version older than this one, signed in after the migration: library and progress no longer
   sync for it (expected, cut over at once); updating it pushes what it has.

## Settings sync without keys and add-on links (T-029, I-009)

Settings documents now carry only what a profile changed from the defaults (`settings_defaults`
command, not run here: src-tauri only type-checks) and never API keys or add-on links. Tested here
as pure functions (`tests/settingsDoc.test.ts`, `tests/secrets.test.ts`); not run in the app.

1. Two devices, one profile: change Seek step on one; the other takes it after a sync. Set it back to
   the default on the first: the second goes back too.
2. A TMDB key or an add-on added on one device does not appear on the other.
3. Settings → Account → Sync API keys and addons → Turn On, same passphrase on both: a key set on one
   arrives on the other, add-ons follow. Another passphrase on the second: it says the keys were
   sealed with another passphrase and keeps its own; the first device's keys stay on the server.
4. Sign out on a device that had its own keys and add-ons before signing in: they are back as they were.

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

## Phone and tablet layouts (T-033)

- No browser runs on this machine (a headless Chromium from npm hangs under the sandbox), so the layouts were
  checked by reading the CSS, and the form-factor rules by tests (tests/formFactor.test.ts). Nothing here has
  been seen on a phone or tablet: the mobile shells don't exist yet (cycle 3).
- To check on Windows now (the app only starts in its shell): `bun run app`, open DevTools in the window
  (right-click → Inspect), turn on device emulation (Ctrl+Shift+M) as a Pixel or iPhone and reload: the user
  agent makes it a phone. Look for: the tabs in a bar along the bottom,
  More taking what doesn't fit; Back, search and the profile at the top; the last row of each page clear of the
  tab bar; the home hero's text across the card with Next at its top right; a show's episode list with the
  number above the title; no window buttons. As an iPad: the desktop layout with 44 px bar icons.
- A desktop window narrower than 600 px now gets the hero and episode-list changes too (not the tab bar).
- Touch: a tap on the playing video shows or hides the controls whatever "Clicking the video" says.

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
  either. The decision is `polar_library::opened` (tested). To check: quit Polar, make `polar.json` in the app
  data folder unreadable (`chmod 000 polar.json` on Linux/macOS; on Windows deny Read in its Security tab),
  start Polar: the toast shows, adding a title fails, and after quitting and restoring the permission the
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
