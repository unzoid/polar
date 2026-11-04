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
- Focus in sheets and the trailer (T-019, `lib/layer.ts`): a sources or Filters sheet and the trailer now take
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
- Player options and TV Back (T-019 step 6, `lib/dismiss.ts`, `lib/layer.ts`): the player's full-window
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
