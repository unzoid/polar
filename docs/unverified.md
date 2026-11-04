# What could not be checked on the dev machine

The work on this branch was done on a Linux VM with no display, no WebKitGTK and no
mpv. `tsc`, `vite build`, `bun run test` and `cargo test` for `polar-addon`,
`polar-anime` and `polar-library` run there; `src-tauri` does not build there, and
nothing could be looked at on screen. This file lists what still needs a person
with the app, and how to check each item. It grows as work lands (T-011 finishes it).

## Built by reading only (`src-tauri`)

`src-tauri` was checked with `rustfmt` and by reading. `cargo build` / `bun tauri dev`
on a desktop is the first check for every item below.

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
- Escape (T-019 step 3, `lib/dismiss.ts`): sheets and the trailer close on Escape through one stack now.
  Before, a sheet closed before anything inside it saw the key, so the "Escape empties the field first"
  above did not work in the episode and source-filter searches; now it should. Check, with a sources sheet
  open: Escape with the Filters popover open closes only the popover; with text in a source-filter search
  it clears the text; a second Escape closes the sheet; a third goes Back. Same for the trailer over a page.
