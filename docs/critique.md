# Polar: critique of the codebase

Reviewed at commit `bcd0a85`, by reading the code. Nothing in the Tauri shell was run. The front-end
reviewer ran a production build (`tsc` + `vite`) with sourcemaps to measure the bundle; nothing else was built or run.

Scope: the React/TS front end (`src/`), `src/lib`, the Rust crates (`crates/addon`, `crates/index`), the
Tauri shell (`src-tauri/`), the Supabase migrations, build scripts and CI. Every `file:line` below refers
to `bcd0a85`.

Severity: **Critical** means data loss that is guaranteed or likely, secrets exposed, or the app dying with
no way to recover. **High** means likely real-world data loss or corruption, wrong behaviour on the main
path, or a structural cost that keeps causing bugs. **Medium** means a real bug or risk that
needs a less common trigger, or a large maintenance cost. **Low** covers hygiene and polish. Within each
level, findings are ordered by cost. Area tags: UI, lib, sync, Supabase, Rust, build/CI.

---

## Summary: the structural problems that cost the most

1. **User data is not safe on disk or across sign-out.** A transient read error at startup makes the app
   overwrite `polar.json` with an empty store (C1). Signing out or switching profiles deletes every change
   not yet pushed, after a 4-second wait (C2). Neither one warns the user.
2. **Sync trusts client clocks and whole documents.** Library, progress, playlists and settings resolve
   conflicts by last-write-wins on `Date.now()` from different machines. Rejected writes are recorded as
   pushed, settings sync replaces the whole document and uninstalls addons, and the playlist limit trigger
   can stop sync for good (H2-H5).
3. **Secrets go to the server in plaintext.** TMDB/Seekr/MDBList/OMDb keys and addon URLs carrying the
   user's add-on tokens are synced into `profile_settings` as plain JSON. Legacy stream URLs stay in `watch_progress`
   (C3).
4. **An anime has no stored identity.** The id a show is saved under (`tt…` or `kitsu:N`) is recomputed
   on every visit from ani.zip, Cinemeta search, today's date and whether the network answered. When
   that answer changes, library, progress and playlists split or are orphaned. The anime data the player
   needs (filler, AniSkip, Kitsu alt ids, stills) lives in memory maps that only the desktop anime page fills
   (H1, H6).
5. **No safety net in the front end.** There is no error boundary and no reload, so one render exception
   (and there is a reproducible one, C5) blanks the window. There are no front-end tests and no linter, and
   the Rust tests miss the risky paths (store, downloads, sync clocks) (C4, H7).
6. **Duplicated behaviour that has already drifted.** There are four title-page implementations, two
   settings UIs plus a third copy as the search index, and query keys typed by hand in components. The
   Rust and TS types are mirrored by hand, and stream selection is split across the language boundary
   (H14, H15, M5, M29).
7. **Network use is unbounded.** TMDB fan-out is about 250 requests at cold start, with no limiter, no 429
   handling, and thinned results cached for an hour. TMDB pagination repeats and skips titles. AniList,
   ani.zip and Jikan have no shared limiter, and Jikan retries 429 forever. Response bodies have no size
   cap (H10, H11, M10, M13).
8. **Main-thread blocking and big modules.** Synchronous whole-file JSON rewrites run on the UI thread
   every 5 s during playback. `Player.tsx` re-renders entirely 4 times a second, and `Settings.tsx` is
   2009 lines (H8, H17, M27).

---

## Critical

### C1. A transient read error at startup silently wipes the user's whole store (Rust)
- `src-tauri/src/store.rs:386-398`: `Store::load` treats **any** `Err` from `std::fs::read` as "fresh"
  (`Data::default()`). That includes PermissionDenied, a Windows sharing violation while antivirus,
  OneDrive or a backup tool holds the file, and EIO. Only a *parse* error makes a backup.
- `src-tauri/src/lib.rs:65-80` (`install_bundled_addons`) then sees no bundled addons, installs
  OpenSubtitles and calls `store.save()` (`lib.rs:79`). The empty default overwrites the real
  `polar.json` about a second after launch: library, history, every profile space, installed addons
  (with their tokens) and API keys, with no backup.
- The corrupt-file branch also ignores whether its backup copy worked (`store.rs:394`,
  `let _ = std::fs::copy`).
- `src-tauri/src/downloads.rs:122-125` does the same: any read or parse failure gives an empty list, the
  next save (`downloads.rs:151-159`) erases every record, and the files stay on disk with nothing
  pointing to them.
- Fix: treat only `ErrorKind::NotFound` as fresh. On any other error, refuse to save (read-only mode) and
  show the error. Back up before overwriting. Apply the same rules to `downloads.json`.
- (The Rust reviewer rated this High. It is raised here because the loss is total and silent.)

### C2. Signing out or switching profiles can permanently delete changes that never reached the server (sync)
- `src/lib/account/AccountProvider.tsx:248` waits for `sync.flush()` for **at most 4 s**, then `:249`
  `sync.stop()` and `:252` `api.forgetSpace(null)`. In Rust, `space_forget(None)`
  (`src-tauri/src/sync.rs:77`) removes **every** profile's space, including tombstones, progress and
  `pushed_at`.
- If the device is offline or slow, or the backend returns an error (`playlist_limit`, H4; settings over
  16 KB, M7), everything changed since the last successful push is gone, with no warning.
- Profiles that are not active fare worse. `sync.ts` only syncs `active` (`sync.ts:39,44`), and `enter()`
  flushes the previous profile with a 3 s race (`AccountProvider.tsx:81`). Nothing retries that profile's
  unpushed rows until it is opened again, so a later sign-out wipes them.
- Fix: before `forgetSpace`, sync every cached space. If anything is still unpushed, refuse or ask ("N
  changes haven't synced; sign out anyway?"). Sync dirty non-active profiles in the background.

### C3. Third-party secrets are stored in Supabase as plaintext JSON (Supabase, sync)
- `src/lib/account/settingsSync.ts:22`: `DEVICE_ONLY` was only a device setting and `metadataSource` (now only `metadataSource`).
  So `current()` (`settingsSync.ts:58-63`) puts `tmdbKey`, `seekrKey`, `mdblistKey` and `omdbKey`
  (`src/lib/types.ts:198,203,269,270`; Rust `store.rs:14,22,104,106`) into `profile_settings.data`.
- `settingsSync.ts:62` syncs every installed addon's `manifestUrl`. Configured stream addons carry the
  user's API key for their service in that URL. The party code says so itself
  (`src/lib/party/party.ts:12-13`, "add-on links can carry API keys").
- `supabase/migrations/20261101200000_profile_settings.sql:24-26` leaves the legacy `watch_progress.stream`
  column (full stream objects with URLs, often signed links with keys) on the server. The cleanup is
  commented out as "optional".
- The same document is cached unencrypted in `localStorage` under `polar.settingsSync.<profile>`
  (`settingsSync.ts:40,49`).
- Impact: one leaked session, a careless dashboard export, or any future RLS mistake exposes paid-service
  credentials for every user.
- Fix: keep key fields and addon URLs device-only, or encrypt them client-side with a key that stays on the
  device. Run the `stream = null` cleanup as a real migration, then drop the column.

### C4. No error boundary anywhere, and no way to reload (UI)
- There is no `ErrorBoundary`, `getDerivedStateFromError` or `componentDidCatch` in `src`.
- Any render-time exception unmounts the whole React root. Sources include C5, non-null assertions such
  as `src/screens/Player.tsx:1016` `profile!` and `src/screens/AnimeDetail.tsx:170` `find(...)!`,
  `as never` casts, and unexpected data from AniList, ani.zip, Jikan and addons, which the anime screens
  read deeply.
- `src/App.tsx:148-158` disables the native context menu, and the window has no browser chrome, so the
  user can't even "Reload". They have to quit the app.
- Fix: a boundary per page `<section>` (`App.tsx:231-240`, `src/tv/TvApp.tsx:204-222`), one around
  `PlayerLayer`, and a top-level one with a "Reload" button.

### C5. Query-key collision between Discover and Search crashes the app (UI)
- `src/screens/Discover.tsx:26-27` caches `useInfiniteQuery({ queryKey: ["discover", type, catalog, genre ?? ""] })`,
  whose data is `{ pages, pageParams }`.
- `src/screens/Search.tsx:64-68` (`GenreRow`) caches `useQuery({ queryKey: ["discover", type, "popular", genre] })`,
  **the same key**, with a plain `MetaPreview[]`.
- Repro: search "horror" (`Search.tsx:52` renders `GenreRow`), then open Movies with Genre = Horror,
  Catalog = Popular. `Discover.tsx:49` runs `query.data?.pages.flat()` on an array and throws during
  render. With C4, the window goes blank. In the other order the "Popular Horror Movies" row silently
  disappears (`Search.tsx:73`).
- Root cause: query keys are literals scattered through components instead of the `keys` factory in
  `src/lib/net/queries.ts` (M29).

---

## High

### H1. Anime identity is derived at runtime from third-party data that changes, so records split and get orphaned (lib, sync)
At `bcd0a85` the page chooses an anime's id like this: `metaId = imdbForAnime(...) ?? kitsu:N`
(`src/screens/AnimeDetail.tsx:118-123`, through `useAnimeImdb`, `src/lib/anime/search.ts:73-81`; TV
`src/tv/TvAnime.tsx:167` and `:202-203`). `imdbForAnime` (`search.ts:101-112`) works as follows:
- no IMDb link but a Kitsu id on ani.zip: `null`, so the show is `kitsu:N`;
- an IMDb link, and none of the entry's *aired* episodes (by date, `airedEpisodes`, `anizip.ts:146`) are
  in that show's Cinemeta videos: a Cinemeta title search for another show (`findImdbId`,
  `search.ts:138-162`), falling back to the linked id;
- otherwise ani.zip's link.

This fixed real playback bugs (Paleblade: Hundred-Night Ash War is now its own IMDb show), but the id is
still computed, never stored, and it now depends on more inputs:
- **Time.** Before an entry's first episode airs, `aired` is empty and the linked id is kept
  (`search.ts:107`). Once episodes air and the linked show doesn't have them, the id switches to another
  show. Anything saved before the premiere (library, playlists) stays under the old id.
- **Network outcome.** If the linked show's `meta` fails, the linked id is kept (`search.ts:108-109`). If
  it succeeds, the search may pick a different show. If `search` throws, the desktop query errors,
  `foundImdb` is undefined, and the page falls back to `kitsu:N` or "Not linked to any sources yet"
  (`AnimeDetail.tsx:120-123`, `:252`). TV's card falls back to the linked id instead
  (`TvAnime.tsx:167`). So one entry can be saved under two or three ids depending on the session.
- **Upgrade.** Users who watched a part like HNAW before `bcd0a85` have progress under the parent show's
  `tt`. The page now uses another `tt`, and nothing re-keys the old rows.
- **Cinemeta data.** If Cinemeta later adds the episodes to the linked show (or fixes dates), the id flips
  back.
- **Kitsu ↔ IMDb.** When ani.zip later adds an `imdb_id` for a show that only had a Kitsu id (common for
  new seasons), the show moves from `kitsu:N` to `tt…`. The library, progress, playlists and Continue
  Watching entries stay under the old id, and the show appears twice.
- **Franchises split.** Each AniList cour with no IMDb mapping gets its own `kitsu:` id, while mapped cours
  collapse into one `tt` show.
- **Wrong matches.** For an airing series, a title match now has to contain at least half of the aired
  episodes by air date (`search.ts:150-152`), which is a real improvement. With one aired episode, a
  single date match within ±1.5 days (`anizip.ts:123`) is enough. Movies and series with nothing aired
  still match by normalized title and year ±1 (`search.ts:153-156`). `lookupTitles` now also strips part
  names ("… Part 2", "… 2nd Season", `search.ts:119-128`), which widens what a movie can match.
- Episodes of a show other than ani.zip's link are placed by `alignByAirDate` (`anizip.ts:170-190`,
  used at `AnimeDetail.tsx:135`). It is careful, but if it is wrong, progress is written to the wrong
  episode's video id.
- `withoutAnime` (`search.ts:169-186`) dedupes Cinemeta against AniList by title and year only. It hides
  non-anime titles that share a name and never links ids.
- The result is cached in memory only (`["anime","imdb",id]`, 6 h), so it is recomputed every session.
  Nothing persists AniList ↔ metaId, so none of this can be repaired later. See Appendix A.
- Fix: a local, synced `aliases` table (AniList/MAL/Kitsu → canonical id) written at first save. Read it
  before recomputing. Re-key when the canonical id changes.

### H2. Last-write-wins on client clocks, with no server clamp, and rejected writes are recorded as pushed (sync, Supabase)
- `supabase/migrations/20261101000000_accounts_profiles_sync.sql:70-78`: `sync_lww` compares
  `new.updated_at <= old.updated_at`, both client `Date.now()` values (`src-tauri/src/commands.rs:293,307`,
  `src/lib/library/playlists.ts:79`, `settingsSync.ts:122`). Rust's merge does the same across machines
  (`sync.rs:151-184`).
- A device whose clock runs ahead wins every conflict. Later edits from correct devices are dropped
  silently until real time catches up. Nothing bounds `updated_at` (for example against `now() + 5 min`).
- When the trigger returns `NULL`, the upsert still succeeds, and the client marks the write pushed
  (`sync.ts:52` library/progress, `sync.ts:62` playlists). Settings save the local doc as agreed at a
  timestamp the server never accepted (`settingsSync.ts:124`). The next round applies the remote doc
  over the user's edit (`:141`), so **the change is reverted without notice**.
- `sync_changes` filters `updated_at >= pushed_at` (`sync.rs:87-106`, `pushed_at` from the local clock,
  `sync.rs:89,112`). If the clock steps backwards (NTP, a manual change, a dual-boot RTC), edits in that
  window are never pushed.
- `progress_save_many` stamps future times on purpose, `at + i` (`commands.rs:306-309`), so a long show
  is up to a second ahead.
- Every pulled progress row with `updated_at >= pushed_at` is echoed back on the next push
  (`sync.rs:104`). The server rejects it, and the bandwidth is wasted.
- Tests cover only the pure merge (`sync.rs:220-269`).
- Fix: a server-assigned revision or a hybrid logical clock, plus a local dirty flag instead of the
  wall-clock filter. Clamp timestamps on the server. Have the RPC return whether each row was accepted.

### H3. Settings sync is one whole-document LWW with destructive side effects: it uninstalls addons (sync)
- `apply()` uninstalls every installed addon not in the incoming doc (`settingsSync.ts:80`).
  - First use of an existing profile on a new device (`saved == null`, a remote doc exists): `take(remote)`
    (`:134`) uninstalls that device's addons.
  - Every profile switch runs `restoreSettings` (`:100-105`, from `AccountProvider.tsx:85`), which
    uninstalls and reinstalls addons over the network.
- Race: `enter()` gives `restoreSettings` 1.5 s (`AccountProvider.tsx:85`), then starts sync (`:90`).
  While installs are still running, `current()` sees a partial set, `changedHere` is true
  (`settingsSync.ts:136,139`), and the truncated list is pushed. `restoreSettings` then writes the older
  `saved` (`:104`), so the next round applies the truncated doc and uninstalls the addon on every device.
- Upgrades break it as well. A new `Settings` field makes `changedHere` true, so this device's whole doc
  wins over newer remote edits. An older client drops fields it doesn't know and pushes, which erases
  them for newer clients. (`bcd0a85` just added two synced values, `uiFont: "opendyslexic"` and the
  `animePreferredGroups` pref, so this applies now.)
- Addons are sorted by URL (`:62`), so order is lost. `removeAddon` goes by `manifest.id`, but the
  comparison is by URL (`:80`).
- Fix: per-key merge with per-key timestamps (or a three-way merge against `saved.doc`). Never auto-uninstall
  on first contact. Finish `restoreSettings` before the first `syncSettings`.

### H4. Playlist limit: tombstones count and the trigger fires on upserts, so playlist sync breaks permanently and settings sync stops with it (Supabase, sync)
- `supabase/migrations/20261101120000_playlists.sql:22-32`: a `BEFORE INSERT` trigger counts **all** rows
  for the profile, deleted ones included. Nothing purges them, and `deletePlaylist`
  (`src/lib/library/playlists.ts:113`) keeps a tombstone forever.
- Push uses `upsert(..., { onConflict: "id" })` (`src/lib/account/supabase.ts:207`). PostgreSQL fires
  `BEFORE INSERT` row triggers for `INSERT … ON CONFLICT DO UPDATE`, so at 100 rows **updating an existing
  playlist** also raises `playlist_limit`.
- `dbError` (`supabase.ts:355-367`) doesn't map it. `sync.ts:69-72` logs it and retries forever. Because
  playlists run before settings in `run()` (`sync.ts:59-67`), **settings never sync again** for that
  profile.
- Fix: count only `deleted = false`, check only on real inserts (`not exists` on `id`), purge old tombstones,
  and map the error. One SQL test would have caught this.

### H5. Playlist codec has no forward compatibility: an unknown version or a bad blob becomes an empty playlist, and that propagates (lib, sync)
- `src/lib/library/playlistCodec.ts:52`: an unknown version byte returns `[]`. `:79-81`: a decode error keeps
  a prefix. `fromHex` (`:89-94`) doesn't validate (odd length or non-hex become 0).
- `applyRemotePlaylists` (`playlists.ts:157-174`) adopts any newer remote row, so an old client receiving
  a v2 blob replaces the list with nothing. The next local edit (`:72-83`) re-encodes it with a newer
  timestamp and pushes it, and the content is lost everywhere.
- Fix: on an unknown version, keep the raw bytes and make the playlist read-only. Never re-encode a list
  that failed to decode.

### H6. Anime context lives in in-memory maps filled by rendering the desktop anime page (UI, lib)
- Four module-level maps (`src/lib/anime/altIds.ts:9`, `aniskip.ts:14`, `filler.ts:6`, `stills.ts:8`)
  are filled **as a side effect of rendering** `AnimeDetail` (`AnimeDetail.tsx:181-188`, `418-420`,
  `625-637`). They grow without bound and are lost on restart.
- The player reads them: `Player.tsx:241` `isFiller` ("Skip filler"), `Player.tsx:563`/`971`
  `stillFor`, AniSkip and the Kitsu alt stream ids.
- So these silently lose filler skipping, AniSkip segments for Kitsu shows (`aniskip.ts:23-24` handles
  only `tt`), Kitsu-alt sources (fewer streams) and stills:
  - resuming from Continue Watching after a restart;
  - anything reached through its IMDb page before the redirect resolves;
  - **everything in TV mode**. `TvAnime.tsx:164-178` and `TvAnimeDetail` (`:193-212`) route to the
    plain IMDb `TvDetail`, and no TV file calls `remember*`.
- "Skip filler" is offered in both modes (`src/screens/Settings.tsx:1226-1231`), so it looks broken.
- Fix: derive the mappings from a query keyed by metaId/videoId that the player can run itself, backed by
  the persisted mapping from H1.

### H7. Tests and CI don't cover the risky code; the front end has no tests and no linter (build/CI)
- Front end: there is no test runner, no test files and no ESLint/Biome config. CI
  (`.github/workflows/ci.yml:31`) runs only `bun run build` (tsc + vite). There are 13
  `eslint-disable-next-line react-hooks/exhaustive-deps` comments for a linter that isn't installed
  (e.g. `Player.tsx:380`, `AnimeDetail.tsx:636`, `Settings.tsx:1708`, `src/lib/catalog/calendar.ts:89`), and
  effects omit dependencies on purpose (`Player.tsx:335-353`).
- Pure TS worth testing first: `playlistCodec`, `oneFranchiseEach`, `byRelevance`, `matchVideo`,
  `alignByAirDate`, `imdbForAnime` (with a fake `Lookup`, which it already accepts), `upNext`/`nextVideo`,
  `compareVersions`, the `settingsSync` merge, `sources.matches`/`defaultFilter`/`autoPickOrder`,
  `groupBoost`, plus logic inside components (`usePlayback` episode merging `AnimeDetail.tsx:129-177`,
  `showNextUp` `Player.tsx:700-711`, `resumePoint` `:330-333`, TV `Row` stepping
  `TvSettings.tsx:262-275`).
- SQL/RLS: none. H4 would have been caught by one test.
- Rust: about 33 tests (`player.rs` 11, `rank.rs` 7 after `bcd0a85`, `sync.rs` 5, `client.rs` 2, `subs.rs`
  2, `curate.rs` 2, `fillers.rs` 1, `seekr.rs` 1; 2 `#[ignore]`d network tests). Nothing tests `store.rs`
  load/save/error paths (C1), `downloads.rs` (H9), `commands.rs`, TMDB parsing and pagination (H10),
  `cinemeta.rs`, `ratings.rs`, `introdb.rs`, the pure `streamcheck`/`trailers::pick`, or `Indexer`
  caching.
- CI (`ci.yml:33-69`) has no Linux Rust job though Linux is a target (`player.rs:289-293`), no
  `cargo audit`/`cargo deny`, and a floating `stable` toolchain (`ci.yml:47`) with `-D warnings`, so a new
  clippy lint can turn CI red with no code change. There is no `rust-toolchain.toml` or `rust-version`,
  though the code uses recent APIs (`Option::is_none_or`, `LazyLock`).
- Fix: Vitest plus `eslint-plugin-react-hooks` in CI, store/downloads/sync tests in Rust, a Supabase test for
  the triggers, and a pinned toolchain.

### H8. Synchronous whole-file JSON rewrites on the main thread, every 5 s during playback (Rust)
- In Tauri v2, non-`async` commands run on the main thread. `progress_save` (`commands.rs:292-297`),
  `library_toggle`, `settings_set`, all `sync_*` commands (`sync.rs:39-43`) and `download_pause/remove`
  are synchronous. Each goes through `persist` (`commands.rs:213-217`) and then `Store::save`
  (`store.rs:404-411`), which pretty-prints the **entire** store while holding the global
  `Mutex<Store>`.
- The player saves progress every 5 s (`Player.tsx:68,450`), so the cost grows with history and lands on
  the UI thread.
- `downloads.rs:302-306` writes `downloads.json` with `std::fs` under a std `Mutex` inside a tokio task.
- Fix: `async` commands, a debounced background writer, compact JSON, progress out of the settings file
  (or SQLite, as `store.rs:3` already suggests).

### H9. Downloads: no read timeout, and pause→resume can corrupt the file (Rust)
- Only `connect_timeout` is set (`downloads.rs:137-141`), so a stalled body leaves `res.chunk().await`
  (`:298`) pending forever. Pause only sets a flag, which is checked before awaiting the next chunk
  (`:294`), never between receiving and writing.
- Pause during an in-flight chunk, then resume: `spawn` starts a second transfer on the **same file**
  (`:195-207`), reads `have = metadata.len()` (`:246`) and appends. The old task's chunk is then written
  (`:300`) into the middle of the new stream, and the file is silently corrupt.
- `Content-Range` on a 206 is never checked against `have` (`:270-272`).
- Fix: an idle timeout, a stop check after each chunk, one transfer per file at a time, and `Content-Range`
  validation.

### H10. Pagination with TMDB repeats and skips titles (Rust)
- `crates/index/src/lib.rs:114`: `page = skip / PAGE_SIZE + 1`, `PAGE_SIZE = 20` (`lib.rs:22`).
  `Tmdb::previews` (`crates/index/src/tmdb.rs:147-154`) drops results with no IMDb id, so pages often have
  17-19 items. The UI asks with `skip = items so far` (`src/screens/Discover.tsx:30`). With 18 items,
  `skip=18` is page 1 again, so the same titles are appended twice (with duplicate React keys) and pages
  drift.
- Units also differ by backend: Cinemeta pages by 50 (`cinemeta.rs:13`), and curated shelves by 30
  (`lib.rs:35`).
- Fix: return a cursor or `next_skip` from Rust.

### H11. TMDB fan-out: N+1 requests, no concurrency limit, no 429 handling, partial results cached (Rust)
- Each TMDB list page makes 20 concurrent `/external_ids` calls through an unbounded `join_all`
  (`tmdb.rs:147-165`). Home asks for about 12 catalogs at once (`src/lib/catalog/shelves.ts:67-76`), so a cold
  start fires about 250 requests.
- A failed lookup quietly drops the title (`tmdb.rs:152`), and the thinned list is cached for an hour
  (`crates/index/src/lib.rs:92,139`). The id map (`tmdb.rs:37`) is memory-only and is rebuilt when the
  language changes (`commands.rs:370-381`).
- The Cinemeta path has the same shape: no single-flight (`crates/index/src/lib.rs:170-181`), so the four
  curated shelves each fire their own 8-page pool fetch (`cinemeta.rs:31-35`), which is about 64 requests
  instead of 16.
- Fix: `buffer_unordered(8)`, retry 429/5xx with backoff, don't cache lists with failures, persist the
  tmdb→imdb map, and add single-flight.

### H12. Trailers from IMDb's unpublished web API, fillers parsed from animefillerlist's HTML (Rust)
- `src-tauri/src/imdb.rs:11,31,36` POSTs to `api.graphql.imdb.com` with a browser UA and
  `x-imdb-client-name: imdb-web-next-localized`, which it needs: it "answers 403 without the web client's
  name" (`imdb.rs:1-2`). `trailers.rs:9-11` takes signed CDN MP4 URLs through it. The API isn't published,
  so it can change or stop answering at any time.
- `fillers.rs:38-54` parses animefillerlist.com's HTML by splitting on class strings, so any markup change breaks it.
- Neither is cached, and each call builds a new HTTP client (`imdb.rs:28-33`, `fillers.rs:12-19`).
- Fix: use TMDB's YouTube keys (`tmdb.rs:313-315`) and Cinemeta `trailers` by default, and make IMDb opt-in
  or remove it. Use Jikan for fillers, with the HTML parser as a cached fallback.

### H13. Unbounded server storage with open sign-up (Supabase)
- Sign-up is open (`supabase.ts:87` `shouldCreateUser: true`).
- `library_items` and `watch_progress` have no row cap and no length checks on `meta_id`, `name`,
  `poster`, `background` or `episode_title` (`accounts_profiles_sync.sql:30-64`). `type` has no check and
  gets `''` for tombstones (`sync.rs:96`).
- Normal use grows without bound: one `watch_progress` row per episode ever touched, "mark show watched"
  writes a row per episode (`src/lib/library/watched.ts:69-80`) each repeating title metadata, and tombstones are
  never pruned (`store.rs:333`; playlists, H4).
- Fix: `check (char_length(...) <= N)`, per-profile row limits (done correctly, unlike H4), tombstone GC,
  title metadata moved out of per-episode rows.

### H14. Four title-page implementations whose behaviour has drifted apart (UI)
`Detail.tsx` (377 lines), `AnimeDetail.tsx` (950), `TvDetail.tsx` (509) and `TvAnime.tsx`/`TvAnimeDetail`
(220) each re-implement the same things.
- The "play, or open the source picker" rule appears 5 times: `Detail.tsx:143-148`, `:301-308`,
  `AnimeDetail.tsx:237-241`, `:444-451`, `TvDetail.tsx:52-57`.
- The Sheet + StreamList picker is copied 4 times: `Detail.tsx:232-250`, `:357-373`,
  `AnimeDetail.tsx:321-337`, `:561-577`.
- Up Next differs: Detail/TvDetail use `lib/playback/playTarget` + `episodes.upNext`, while AnimeDetail has its own
  (`AnimeDetail.tsx:190-216`, `>30 s` resume rule, "touched last") and its own labels (`:243-250`). One
  show can offer "Resume" on one page and "Play Episode N" on another.
- Opposite routing: desktop sends an anime reached by IMDb id *to* its AniList page (`Detail.tsx:32-50`),
  while TV sends AniList ids to the IMDb page (`TvAnime.tsx:193-212`).
- Two playability rules within TV. Since `bcd0a85`, both paths use `imdbForAnime`, and that returns `null`
  for a Kitsu-linked entry (`search.ts:103`). The rail card stops there ("Not available from your sources
  yet", `TvAnime.tsx:164-172`), while the deep link falls back to Kitsu (`:203`). A Kitsu-only show is
  unplayable from the TV rails but plays from a link. Error fallbacks also differ from desktop (H1).
- `MAX_SEASON_TABS = 6` is defined twice (`Detail.tsx:256`, `AnimeDetail.tsx:586`).
- Fix: one `useTitlePlayback(model)` hook and one `<SourcePicker>`.

### H15. TV and desktop settings are separate hand-maintained copies that disagree (UI)
`Settings.tsx`, `TvSettings.tsx` and `src/lib/settings/searchIndex.ts` (search entries keyed by the **exact
on-screen title string**, `settingsIndex.ts:5-8`) describe the same settings separately.
- Resolution: desktop offers 4K/1080/720/480 (`Settings.tsx:612-618`), TV offers 4K/1440/1080/720
  (`TvSettings.tsx:31-37`). Each side's unique value shows raw on the other (`TvSettings.tsx:264`).
- Mature content: desktop has show/blur/hide (`Settings.tsx:1056-1058`). TV shows "blur" as "Hide"
  (`TvSettings.tsx:201`) and stepping overwrites it.
- Seek step: 1-120 on desktop (`Settings.tsx:537-545`), steps of 5 on TV (`TvSettings.tsx:162`).
- Languages: desktop adds the current one if missing (`Settings.tsx:731-734`), TV doesn't
  (`TvSettings.tsx:52-55`).
- Defaults: desktop guards required fields (`Settings.tsx:414`, `:425`, `:471`), and TV passes them raw
  (`TvSettings.tsx:148`). Either the types (`types.ts:232-238`, non-optional) are wrong or the guards are
  dead code.
- Search scrolls by matching title text (`SettingsOverlay.tsx:80-83`), so renaming a row breaks its
  search. `bcd0a85` added three more index entries by hand (`settingsIndex.ts:60,73,106-110`).
- Fix: one declarative settings schema rendered by both UIs and used to build the index.

### H16. Settings saves: two write paths, a stale snapshot, and drafts that get overwritten (UI)
- `Settings.tsx:1843-1853` `useSaveSettings` sends `{ ...data!, ...patch }` from the **render-time**
  snapshot, while `useUpdateSettings` (`src/lib/net/queries.ts:191-206`) reads the live cache. A typed-field
  save (TMDB, MDBList, OMDb, server, Seekr) can undo a toggle made a moment earlier. `PreviewsRow` calls it
  twice on the same stale `data` (`:1972`, `:2004`).
- `ArtworkRow` and `RatingsRow` never show `save.isError`.
- Seven "draft mirrored from server or prefs" effects (`:591`, `:1143`, `:1785`, `:1786`, `:1859`,
  `:1906`, `:1940`) overwrite what the user is typing when settings refetch, for example when cloud sync
  lands. The `:1143` one (Preferred Release Groups) is new in `bcd0a85`.
- `PreviewsRow` verifies and saves at the same time (`:1970-1972`), so an invalid key is saved.
- Fix: one mutation path, and drafts initialised once per open with a "changed elsewhere" notice.

### H17. `Player.tsx` is a god component that re-renders in full 4 times a second (UI)
- It is 1174 lines, with about 25 `useState`, 20 effects and 5 `OptionsOverlay` instances. It owns engine
  choice, the mpv lifecycle, progress, resume, chrome, the keyboard, autoplay, the party, the pickers and
  fullscreen.
- `timeupdate` → `setTime` (`Player.tsx:446-451`), with mpv `time-pos` throttled to 250 ms
  (`src-tauri/src/player.rs:58`), so the whole tree renders at about 4 Hz.
- Unmemoised per-tick work: `episodeItems` (`:549-568`), `sourceItems` (`:578-592`, O(n²) `indexOf`),
  `currentSourceIndex` (`:593`).
- The global `keydown` handler (`:596-671`) depends on `skip`, a fresh object every render
  (`SkipSegments.tsx:103-106`), so it is rebound every tick.
- Three notice timers are never cleared (`:377`, `:463`, `:512`). `let autoplayStreak` (`:81`) is mutable
  module state (`:410-420`).
- Fix: split into hooks (`usePlaybackEngine`, `useProgressSaver`, `usePlayerKeyboard`, `useAutoplay`), and
  keep `time` in a ref or a subscribed child.

---

## Medium

### M1. API keys leak into user-visible errors and the polar-index HTTP API (Rust)
- With a v3 key, TMDB auth is in the query string (`tmdb.rs:47`). `reqwest::Error`'s `Display` includes
  the URL, `IndexError::from` keeps it (`crates/index/src/lib.rs:49-52`), `CmdError` passes it through
  (`commands.rs:18-31`), and the UI shows it. A bad network or revoked key puts the key on screen.
- `bin/polar-index.rs:288-293` returns the same string behind `CorsLayer::permissive()` (`:31`), so any
  web page can read it from `127.0.0.1:7000`.
- MDBList/OMDb keys are also in the query (`ratings.rs:116,118,143`). Their errors are swallowed, so they
  don't leak today.
- Fix: `e.without_url()`, the TMDB bearer header, and error categories.

### M2. Tauri capabilities undo the Rust-side guards (Rust)
- `src-tauri/capabilities/default.json:16` grants `opener:default`, which includes `allow-open-url`
  (http, https, mailto, tel) and `allow-reveal-item-in-dir`. The webview can bypass `open_external`'s
  https-only check (`commands.rs:502-508`) and reveal any path, which defeats `download_reveal`'s by-id
  design (`downloads.rs:426-434`).
- Fix: drop `opener:default` (the Rust commands cover both uses) or scope it.

### M3. macOS: untrusted media decoded in the app process; libmpv loaded from user-writable paths (Rust)
- libmpv runs in-process on macOS (`player.rs:505-532`, `mpv_view.m:212-287`), so FFmpeg decodes media
  from arbitrary add-on links in the process that holds the keys. A decoder crash kills the app, and
  `Engine::alive` is always `true` for `InApp` (`player.rs:92`).
- `mpv_library()` falls back to `/opt/homebrew/lib`, `/usr/local/lib` and `/opt/local/lib`
  (`player.rs:205-207`), which are usually user-writable. The app is ad-hoc signed
  (`release-mac.ts:178`), so library validation doesn't help.
- Fix: load only the bundled `../Frameworks` copy in release builds, and consider a helper process
  (Windows already runs mpv out of process).

### M4. Local store format: no schema version, whole-struct settings writes, secrets in plaintext, no fsync (Rust)
- `Data` (`store.rs:341-357`) has no version. The only migration is ad hoc (`store.rs:368-377`). An older
  build opening a newer file drops unknown fields on the next save.
- `Settings` is `#[serde(default)]` (`store.rs:12`), and `settings_set` replaces the whole struct
  (`commands.rs:370-381`). A TS client that omits a field silently resets it. Nothing is validated
  (`seek_step = 0` is accepted). `ui_font` is a free `String` (`store.rs:46`) while TS has a union
  (`types.ts:6`).
- API keys (`store.rs:14,22,104,106`) and add-on tokens in addon `manifest_url`s (`store.rs:268-271`)
  are stored as plaintext, with default file permissions and no keychain.
- `save()` (`store.rs:404-411`) does temp+rename with no `fsync`. `migrate_legacy_store`
  (`lib.rs:47-58`) ignores copy errors.

### M5. Rust/TS contract mirrored by hand, and stream selection split across the boundary (lib, Rust)
- `src/lib/types.ts:1` "Mirrors the Rust types". `Settings` has about 55 fields in Rust
  (`store.rs:13-139`) against `types.ts:197`. The same goes for `Progress` (`store.rs:287` vs
  `types.ts:136`), `StreamQuality`/`RankedStream` (`rank.rs:12-47` vs `types.ts:98-122`), `Manifest`
  (`types.rs:8` vs `types.ts:178`) and `Download` (`downloads.rs:60` vs `src/lib/library/downloads.ts:16`).
  There is no `ts-rs`/`specta`, so a renamed field fails silently at runtime, which is worse with M4's
  defaults.
- The watched threshold exists twice (`store.rs:245-247`, default 92 at `:206`; `src/lib/library/watched.ts:12-15`).
- Stream selection is split. Rust scores, dedupes and filters (`rank.rs:321-474`) and parses audio
  languages (since `bcd0a85` it also maps dubs to `en` and ignores "Multi-Subs", `rank.rs:290-317`).
  TS re-sorts, applies tag filters, assumes unlabelled anime is `ja`, adds the preferred-group boost
  (`queries.ts:66-74`, `src/lib/anime/groups.ts`) and keeps per-show player filters
  (`src/lib/playback/sources.ts:224-245`). It maps Rust's display strings back to keys (`rank.rs:162-181` →
  `sources.ts:54-74`, `StreamList.tsx:120`). `prefer_screen_resolution` and `source_filters_hide` live in
  Rust `Settings` (`store.rs:97,100`) but are applied only in TS.
- Fix: generate the TS types, and move ranking inputs into one place with keys, not display strings.

### M6. Same episode, different ids: TMDB vs Cinemeta season numbering (lib, Rust)
- With a TMDB key, episode ids are `tt:{TMDB season}:{TMDB episode}` (`crates/index/src/tmdb.rs:204-209`).
  Without one, they follow Cinemeta/IMDb numbering. For anime and long shows these differ, so adding or
  removing the key re-labels which episode `tt…:2:5` is, and progress points at the wrong episodes.
- Stream addons read `tt:S:E` as IMDb numbering, so TMDB numbering can fetch the wrong episode's sources.
- `metadataSource` is device-only (`settingsSync.ts:22`) while `tmdbKey` syncs.

### M7. Settings doc size limit fails silently and forever (Supabase, sync)
- `profile_settings.data` is checked `pg_column_size <= 16384` (`20261101200000_profile_settings.sql:7`).
  Configured addon URLs can run to several KB each. The violation maps to `unknown`
  (`supabase.ts:366`) and `run()` retries forever (`sync.ts:72`). The user isn't told.

### M8. Pull pagination is by offset on a non-unique sort key (sync)
- `supabase.ts:216-222` orders by `synced_at` only and pages with `range()`. Rows from one upsert share
  `now()`, so a row can be skipped at a page boundary, and the 10 s overlap (`:13`) doesn't help.
- Fix: `order("synced_at").order(pk)` with keyset pagination.

### M9. Remote and stored data is cast, not validated (lib)
- `settingsSync.ts:123,127` (`r.data as unknown as Doc`): a malformed doc makes `saveSettings` throw in
  serde on every run.
- `playlists.ts:39` casts localStorage to `Space`. An older shape without `dirty` crashes at `:80`
  **during module load** (`publish(state)` at `:58`).
- Other casts with no checks: `AccountProvider.tsx:56`, `prefs.ts:139`, `keybinds.ts:83`,
  `party.ts:317-330`, and `fromLibraryRow` casting `''` to `ContentType` (`supabase.ts:287`).

### M10. No shared rate limiting for AniList, ani.zip and Jikan; Jikan retries 429 forever (lib)
- `src/lib/anime/jikan.ts:22-28`: on 429 it runs `page--; continue` with no cap, every 1.5 s, in a
  `queryFn` that isn't cancelled.
- AniList `gql` (`anilist.ts:14-30`) retries once, with no limiter. `useAnimeSeasons` walks up to 40
  sequential requests (`:223,257-271`), there are 17 genre shelves (`:198-211`), and the schedule takes up to
  6 pages (`:359`). AniList allows 30-90 requests/min.
- `fetchAniZip` bypasses the query cache in `kitsu.ts:26`, `aniskip.ts:27`, `search.ts:201,217`,
  `queries.ts:92` (different key) and `TvAnime.tsx:200`. `res.json()` is unguarded (`anizip.ts:53`).
- `imdbForAnime` adds Cinemeta search and meta calls per entry opened. Meta goes through the query cache
  (`cachedLookup`, `queries.ts:47-51`), but search does not.
- `kitsuMeta` calls the full `fetchAnime` (`kitsu.ts:29`) just to build a `Meta`.
- Fix: a per-host token bucket, all lookups through `queryClient.fetchQuery`, capped retries, and `signal`
  passed through.

### M11. Watch-party messages are trusted completely (lib)
- `party.ts:315-341`: `from`, `tl.v`, `tl.by`, `tl.media` and `tl.lag` are unchecked. A member can send
  `v: 1e308` and win every tie (`:330`), force media loads, or impersonate `from`. Joining needs a
  6-character code plus any free account (`20261103000000_watch_parties.sql:6-12`).
- Fix: validate shapes and ranges, cap `v` jumps, and bind `by` to the presence key.

### M12. Local storage outlives sign-out and profile deletion, and guest data isn't carried over (lib)
- `forgetLocal` (`AccountProvider.tsx:167-170`) doesn't remove `polar.playlists.<profileId>`
  (`playlists.ts:35`), and neither does `deleteProfile` (`:236-244`). On a shared machine the next
  person's storage has them.
- Guest playlists aren't carried over by `createFirstProfile` (only library/history are,
  `AccountProvider.tsx:226`, `sync.rs:56-65`).
- Settings, prefs and keybinds are global, so entering a profile overwrites the guest's, and nothing
  restores them.

### M13. No response-size limits on attacker-controlled HTTP bodies; `subtitle_vtt` bypasses CORS (Rust)
- `client.rs:83-90` reads whole bodies from any addon or subtitle URL. `subtitle_vtt`
  (`commands.rs:434-437`) fetches any URL from the webview without CORS, so the page can read LAN and
  localhost responses. `seekr.rs:112` and `fillers.rs:29` read unbounded `text()`.
- Fix: cap bodies (for example 5 MB JSON, 10 MB subtitles) and limit `subtitle_vtt` to URLs from subtitle
  addon responses.

### M14. Logging is almost absent (Rust)
- No tracing subscriber is installed, so `tracing::warn!` (`controllers.rs:45`) goes nowhere. The only
  other output is `eprintln!` (`store.rs:393`, invisible on Windows: `main.rs:2`) and an `NSLog`
  (`mpv_view.m:220`). Errors are dropped with `let _ =`/`.ok()` throughout (`downloads.rs` saves,
  `ratings.rs:108-111`, `imdb.rs:34-43`, `streamcheck.rs:42`, `player.rs:587`).
- Fix: `tauri-plugin-log` or a rolling file appender, with logging at every swallowed error.

### M15. Release and update pipeline gaps (build/CI)
- macOS builds are published as pre-releases with no `latest.json` (`release-mac.ts:211-220`). The
  updater uses `releases/latest/download/latest.json` (`tauri.conf.json:46`), and `latest` skips
  pre-releases. The Windows feed lists only `windows-*` (`release.ts:81-85`). Mac installs never update.
- `release.ts` builds from the working tree and runs `gh release create` with no `--target` and no clean
  check (`release.ts:37-47,102-109`), so the tag can point at different source than was built. That
  undermines GPL corresponding source for the bundled mpv (`release-mac.ts:149-158` does this right).
- The Windows installer isn't Authenticode-signed. The Mac app is ad-hoc signed, and users are told to run
  `xattr -cr` (`release-mac.ts:200`). `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` defaults to empty
  (`release.ts:59`).

### M16. CAM regex false positives hide sources by default (Rust)
- `rank.rs:57` matches `\bTS\b`/`\bTC\b` case-insensitively anywhere, so "….ts", a "TS" site tag or a "TC"
  group count as CAM, get −100 (`rank.rs:350-352`), and are **hidden** (`hide_cam` defaults to true,
  `store.rs:217`).
- Smaller: codec by substring (`rank.rs:87-95`), `SIZE` takes the first size (season packs), and dedupe
  treats `file_idx` `None` and `0` as one (`rank.rs:463`).

### M17. Panic surface: about 80 `unwrap`/`expect`, mostly on `std::sync::Mutex` (Rust)
- `lock().unwrap()` throughout `commands.rs`, `downloads.rs`, `lib.rs:34,68,73`, and
  `player.rs:429,590,605,835,866,957,1001`. One panic under a lock poisons it, and every later command
  panics.
- `expect("http client")` in five `Default` impls (`client.rs:35`, `tmdb.rs:34`, `seekr.rs:67`,
  `introdb.rs:65`, `ratings.rs:69`) runs at setup (`lib.rs:98-107`), so a TLS init failure crashes at
  launch.
- Fix: `parking_lot::Mutex` or `unwrap_or_else(PoisonError::into_inner)`, and fallible constructors.

### M18. Caching mistakes in the side services (Rust)
- `ratings.rs:100-104` caches the merged result even when both upstreams failed, for 6 hours. The key
  records only whether a key is set (`ratings.rs:80`).
- `seekr.rs:121-123` caches any non-401/403 failure as "no previews" for the process lifetime.
- `seekr.rs:57`, `introdb.rs:54` and `ratings.rs:59` are unbounded `HashMap`s. The index's `TtlCache`
  (`cache.rs`) does this correctly.

### M19. Proxy headers are used for downloads but not for playback or the probe (Rust)
- `downloads.rs:89-99,251-253` honours `behaviorHints.proxyHeaders.request`. `mpv_load`
  (`player.rs:707-734`) takes no headers, `http-header-fields`/`user-agent` aren't allowed
  (`player.rs:654-673`), and `streamcheck::prepare` probes without them (`streamcheck.rs:39`). Such a
  source downloads but fails to play ("The source answered 403").
- Fix: pass headers to `loadfile` as an option built in Rust.

### M20. CSP and WebView2 flags are broader than needed (Rust)
- `tauri.conf.json:29-32`: `img-src`/`media-src` allow `http:`, and `connect-src` allows any `https:`,
  any `wss:`, and any port on `127.0.0.1`/`localhost`. It isn't exploitable while `script-src 'self'`
  holds (`:27`), but nothing limits exfiltration if script gets in.
- `tauri.windows.conf.json:13` disables SmartScreen in WebView2, which playback doesn't need.

### M21. "IMDb rating" is TMDB's score when TMDB is the source (Rust)
- `tmdb.rs:383,424` put TMDB's `vote_average` into `imdb_rating`. The UI labels it IMDb (`store.rs:39`,
  `ImdbBadge.tsx`) and `curate.rs:49-51` ranks by it.
- Fix: `rating` + `rating_source`, or fetch the real IMDb rating (MDBList/OMDb have it).

### M22. Schema and table design (Supabase)
- `user_id` duplicates `profile_id` on every synced table, yet every `with check` still runs an `exists`
  on `profiles` (`accounts_profiles_sync.sql:95-98,102-105`, `playlists.sql:38-41`,
  `profile_settings.sql:19-22`).
- `watch_progress` repeats title-level `type`, `name`, `poster` and `background` per episode
  (`accounts_profiles_sync.sql:50-54`).
- The `profiles` limit trigger counts and inserts with no lock, so concurrent inserts can pass 5
  (`:17-26`). There is no unique `(user_id, position)`, and `avatar` has no check (`:10`).

### M23. Bundle: one 1.57 MB chunk (488 KB gzip), no code splitting (UI)
- There is no `lazy(`/`import(`. Main contributors: `@base-ui/react` 635 KB, `react-dom` 620 KB, motion
  534 KB, `@dicebear/notionists` 385 KB (unminified sourcemap sizes).
- dicebear is used only to draw a fixed list of seeded avatars (`Avatar.tsx:3-9`,
  `lib/account/avatars.ts:33+`). Pre-render them.
- `src/tv` + `tv.css` (2022 lines) load for every desktop user. Player, Settings, the account screens and
  AnimeDetail are eager. `bcd0a85` added three OpenDyslexic woff2 files (about 350 KB); check that they
  load only when selected.
- Fix: `React.lazy` for TvApp, Player, Settings/SettingsOverlay and the account screens, and static avatars.

### M24. `catalyst-ui/` and the Tailwind setup are dead weight (UI, build/CI)
- `catalyst-ui/` (25 files, 2486 lines) is imported by nothing. `src/styles/tailwind.css` isn't imported
  (`main.tsx:13-28`), so Tailwind emits nothing. `@tailwindcss/vite` still runs (`vite.config.ts:7`),
  `tsconfig.json` type-checks catalyst-ui, and `@headlessui/react`, `clsx`, `tailwindcss` and
  `@tailwindcss/vite` are dependencies for it alone.
- Fix: delete them.

### M25. Keyboard handling is arbitrated by listener order and CSS class names (UI)
- There are 11 `window` keydown listeners, some capture-phase with `stopPropagation` (`Sheet.tsx:41`,
  `Trailer.tsx:63`, `OptionsOverlay.tsx:118`, `ShortcutSettings.tsx:130`, `TvKeyboard.tsx:78`). The
  bubble-phase ones are `Player.tsx:412,669`, `TvApp.tsx:128,186` and `App.tsx:168,215`.
- Escape ownership depends on DOM sniffing (`Player.tsx:601`, `OptionsOverlay.tsx:100`) and the
  non-reactive `isSettingsOpen()` (`App.tsx:206`). `DesktopApp` (`App.tsx:204-217`) doesn't check
  `defaultPrevented`, unlike `MainApp` (`:163`).
- Fix: one dismiss stack shared by desktop and TV.

### M26. Two desktop Settings UIs, and a TV route that ignores the page (UI)
- The overlay (`SettingsOverlay.tsx`) is primary, but the old page is still reached from
  `StreamList.tsx:56,60` (no search, and `tab` resets the stack). The overlay restyles the page body with
  122 `.t3s` overrides (`settings-overlay.css`). TV routes the same buttons to `TvSettings`, which ignores
  `page` (`TvApp.tsx:44-45`).
- Fix: route to `openSettings(page)` and keep one variant.

### M27. `Settings.tsx` (2009 lines) is one module, and `lib` imports from screens (UI, lib)
- It holds 14 pages, the row primitives, controller UI, addons and services. Rows from two stores (synced
  `Settings`, device `prefs`) sit side by side (`Settings.tsx:459-464`, `513-518`). The `["mpv"]` query
  is repeated (`:798`, `:1285`).
- Layering is inverted: `src/lib/settings/searchIndex.ts:1` and `src/lib/settings/overlay.ts:2` import from
  `screens/Settings`, and `src/lib/settings/prefs.ts:2` imports from `../tv/sounds`.
- Fix: `screens/settings/<page>.tsx`, primitives in `components/settings/`, and shared types in lib.

### M28. AnimeDetail computes its playback model twice per page (UI)
- `usePlayback` runs in `Hero` (`AnimeDetail.tsx:227`) and `Episodes` (`:390`). Both run the
  subscriptions, the merge memo (`:129-177`), the `useAnimeImdb` lookup and the `remember*` effects
  (`:181-188`). `Episodes` rebuilds `list`, `found` and `visible` every render (`:402-416`, `:437-440`).
- Fix: compute once and pass it down.

### M29. Data fetching inside components bypasses the query layer (UI)
- There are 21 inline `useQuery`/`useMutation` calls. One key has different options in two places:
  `["subtitles", type, videoId]` (`TitleDetails.tsx:221-226` vs `useTracks.ts:73-77`). `["mpv"]` appears
  three times (`Player.tsx:109`, `Settings.tsx:798,1285`). `TvStage.tsx:92-97` re-implements `useMeta`.
- Invalidation lists already disagree: a language change invalidates `"recommend"` (`Settings.tsx:990`),
  and a TMDB key change doesn't (`:1862`). Same root cause as C5.
- Fix: every query behind `keys.*` in `lib/net/queries.ts` or per-domain modules.

### M30. Copy-pasted helpers (UI, lib)
- Screens: the "load when near" observer (`Home.tsx:281-294` = `Anime.tsx:242-252`), the infinite-scroll
  sentinel (`Discover.tsx:37-46`, `Anime.tsx:405-412`), `moveFocus` (`OnboardingScreen.tsx:10-24`,
  `ProfilesScreen.tsx:14-28`, already diverged), and search debounce (180 ms `Search.tsx:29-32`, 250 ms
  `TvScreens.tsx:183-186`). Genre lists live in three places (`NavBar.tsx:292`,
  `TvScreens.tsx:301-316`, `lib/catalog/genres.ts:7`), and only desktop drops art-less results
  (`Search.tsx:43-44` vs `TvScreens.tsx:209-210`). There are two library toggle buttons
  (`Detail.tsx:184-192`, `AnimeDetail.tsx:303-313`) and two page-stack renderers (`App.tsx:198-201,231-240`,
  `TvApp.tsx:70-73,204-222`).
- lib: two semver comparators (`updater.ts:169-177`, `marketplace.ts:99-107`), the size-suffix regex
  (`downloads.ts:95`, `sources.ts:111`), the cursor reduce (`supabase.ts:145-148`, `:185`), `isTauri`
  (`api.ts:24`, `updater.ts:25`), `norm`/`DAY`/`midnight` in several files, and the
  `useSyncExternalStore` mini-store boilerplate in about 15 modules (a `createStore` helper would remove it).

### M31. Accessibility gaps (UI)
- Poster cards have no accessible name when "Show titles" is off (`PosterCard.tsx:40`, `cards.css:589-591`).
- Nav tabs have no `onClick` (`NavBar.tsx:143-144`), so screen-reader activation does nothing.
- `Segmented` (`Segmented.tsx:67-73`) and `anime-ranges` (`AnimeDetail.tsx:482-484`) use tab roles with
  no tabpanels. They are radio groups.
- `outline: none|0` appears 57 times against 34 `:focus-visible` rules. Audit them.

### M32. Library sub-views live in local state, not the router (UI)
- `Library.tsx:50-78` keeps the sub-view in `useState`. Esc pops the router (`App.tsx:208`), so Esc inside
  a playlist leaves Library. Anime sub-pages are routes, so the two sections behave differently.

---

## Low

- **L1. Errors are plain strings, sniffed or shown raw** (Rust, lib, UI).
  - `CmdError::Other(String)` serialises to a bare string (`commands.rs:24,27-31`), and modules return
    `Result<_, String>`.
  - The TS maps errors by string sniffing (`supabase.ts:356,363`; party `supabase.ts:51`).
  - The UI shows `String(error)` (`Settings.tsx:1354,1759`, `Detail.tsx:80`), and nine
    `.catch(() => {})` swallow failures (e.g. `Player.tsx:283`).
- **L2. Unversioned localStorage keys** (lib): `polar.auth` (the Supabase session with its refresh token;
  the Tauri store or keychain would be safer), `polar.guest`, `polar.lastProfile`, `polar.profiles.<uid>`,
  `polar.settingsSync.<pid>` (API keys and addon URLs), `polar.playlists.<space>`, `polar.prefs`,
  `polar.keybinds`, `polar.recentSearches`, `polar.lastVersion`, `polar.updateNotes`.
- **L3. `useIsAnime` sends every IMDb title the user plays to ani.zip** (`queries.ts:88-98`). This costs
  privacy and latency for non-anime titles.
- **L4. `useCalendar` fires up to 60 `meta` fetches at once** (`calendar.ts:18,61-68`).
- **L5. Synced keybinds aren't portable across OSes** (`keybinds.ts:72`, `${MOD}+k`).
- **L6. Party timers accumulate** (`party.ts:391`, cleared only on leave). Host election uses each member's
  `Date.now()` (`:176`).
- **L7. Router drops the root tab after 8 pushes** (`src/lib/router.tsx:53` `slice(-MAX_DEPTH)`), so
  `rootTab(stack)` (`App.tsx:130`, `TvApp.tsx:75`) returns a detail page.
- **L8. Linux: `mpv_available` says yes, but playback can't work** (`player.rs:634-640` vs
  `window_id` erroring, `player.rs:289-293`).
- **L9. Orphaned mpv.** `Mpv::kill` uses `try_lock` (`player.rs:440-447`), so exit (`lib.rs:166-171`)
  can skip it. There is no Windows Job Object.
- **L10. Pending IPC requests leak** on timeout or write failure (`player.rs:429-437`). Callers wait the full
  5 s (`player.rs:59`) when the reader ends.
- **L11. Autocrop keeps polling after idle shutdown** (`player.rs:953-978`, until `ensure()` resets
  `tuned`, `player.rs:414`).
- **L12. Fixed snapshot path** `temp_dir()/polar-mpv/frame.jpg` (`player.rs:1420`). Concurrent calls race,
  and on Linux it shares `/tmp` with the IPC socket (`player.rs:311`).
- **L13. Unvalidated ids in URLs:** `yt_id` (`commands.rs:199`), and `ty`
  in `resource_url` (`client.rs:93-101`).
- **L14. A new `reqwest::Client` per call** (`commands.rs:182`, `imdb.rs:28`, `fillers.rs:12`,
  `streamcheck.rs:25`). User agents are inconsistent (`polar/x`, `polarity/x` `fillers.rs:15`, `mpv`
  `streamcheck.rs:28`, a browser's, or none).
- **L15. `streamcheck` worst case:** 20 s × 4 attempts plus sleeps (`streamcheck.rs:14,27,35-57`) can hold
  `mpv_load` for over a minute.
- **L16. Subtitles:** Latin-1 instead of Windows-1252 and no UTF-16 BOM handling (`subs.rs:25-30`). One
  subtitle without `lang` fails the whole response (`types.rs:255-261`). `StreamsResponse.streams` has no
  `#[serde(default)]` (`types.rs:249-251`).
- **L17. Seekr URL assumption:** `format!("{}&st=1", vtt_url)` (`seekr.rs:107`).
- **L18. `player.rs` is 1426 lines** with its test module in the middle (`player.rs:1208-1403`) and
  commands after it (`:1405-1426`).
- **L19. Branding drift:** the window title is "Polarity" (`tauri.conf.json:15`) and the product is "Polar".
  UAs and release titles mix the two.
- **L20. `fetch-mpv.ts` licence files are unpinned** (`fetch-mpv.ts:14-15`, from mpv `master`), while
  the archive is pinned (`:10-13,32-33`).
- **L21. polar-index server:** the manifest omits the `genre` extra (`crates/index/src/lib.rs:227-230` vs
  `bin/polar-index.rs:271`), and it calls `.unwrap()` on bind/serve (`bin/polar-index.rs:247,249`).
- **L22. `streams` failure names:** `failed.dedup()` (`commands.rs:141`) only removes adjacent duplicates,
  and same-named addons merge.
- **L23. CSS sprawl** (UI): about 12.4k lines in 16 global files, 135 hex and 403 `rgb(a)` literals outside
  tokens, about 60 literal radii despite `--r-*` tokens (`tokens.css:61-67`), 17 z-index values up to
  `2147483647` (`shell.css:679`), and about 16 unused selectors.
- **L24. Small UI nits:** unvalidated volume from localStorage (`Player.tsx:131`, NaN throws); remembered
  speed read only at mount (`Player.tsx:141`); nested `MotionConfig` (`main.tsx:50`, `App.tsx:173`) leaves
  account screens ignoring "Reduce motion"; `icons.tsx:18-22` discards `strokeWidth` that callers pass
  (`Settings.tsx:124,255,258`); `startUpdateChecks` restarts on every profile switch (`App.tsx:143`,
  remount via `App.tsx:85`).

---

## Fixed upstream since review

The lib and Rust reviews were written against `f7f49b3`. The ten commits up to `bcd0a85` didn't fully fix
any finding, so none was dropped. Two were partly fixed and have been rewritten above:
- **Anime title fallback (H1).** For a series with aired episodes, a Cinemeta title match is now accepted
  only if it has at least half of those episodes by air date. Before, title and year ±1 were enough. Parts
  that IMDb lists as their own show (Paleblade HNAW) now resolve to that show. Movies and unaired series still
  match by title and year.
- **TV playability rules (H14).** The TV rail card and the TV deep link both use `imdbForAnime` now, so the
  rail card also gets the title search. They still disagree on Kitsu-only shows.

The other changes (OpenDyslexic font, preferred release groups, player-kept source filters, dub and
Multi-Subs language parsing) added no new structural problems. They do extend existing ones: H3 (new synced
values), H15/H16 (a new hand-indexed setting and a new overwritten draft), M5 (more ranking logic in TS),
and M23 (font assets).

---

## What is done well

- **Local-first with a clean seam.** The UI never waits on the network, `AccountBackend` keeps supabase-js
  in one file (`src/lib/account/backend.ts`), and running with no backend is a first-class mode.
- **RLS done right** in the usual ways: the `(select auth.uid())` form, `with check` on profile ownership,
  `security definer` with `search_path = ''`, revoked execute on helpers, and cascading deletes.
- **The mpv IPC allowlist** (`player.rs:642-703`). It has a threat comment and fixed `Tune` presets, so the
  webview can never write `af`/`vf` (`player.rs:749-751`). `mpv_load` accepts only web URLs or owned
  downloads (`player.rs:714-718`), and there are tests (`player.rs:1390-1402`). Also `script-src 'self'`,
  https-only `open_external`, by-id `download_reveal`, `--config=no`/`--ytdl=no`, and sanitised download
  names.
- **No secrets committed.** Every key is user-supplied or from env, and `.env.example` explains the
  publishable key.
- **Careful engineering in hard places:** autocrop with regression tests from real clips
  (`player.rs:874-1206`); macOS FFI teardown order and `@synchronized` drawing; air-date episode matching
  that survives numbering schemes (`anizip.ts:119-143`), with comments explaining why; stream fan-out with
  per-addon timeouts and visible failure counts; lenient addon JSON parsing.
- **Sync basics are sound for a first version:** tombstones are kept, a late pull can't resurrect a forgotten
  space (`sync.rs:128-130`), the cursor is taken before the push, stream URLs are not synced
  (`supabase.ts:306-307`), and the playlist codec is compact and versioned.
- **CI hygiene:** actions pinned by SHA with Dependabot, `persist-credentials: false`, read-only
  permissions, clippy `-D warnings`, `fmt --check`, `--locked`, and the mpv archive pinned by sha256. The
  updater is signed.
- **Front end:** comments explain why throughout. One Player serves desktop and TV, and pages under it stay
  mounted with correct `inert` (`App.tsx:235-237`). Base UI is used for menus and dialogs, cards are real
  buttons, reduced motion is honoured, design tokens are used through `var()` about 1287 times, and
  TypeScript is strict.

---

## Appendix A. Identity model as it is today

Canonical id: **the IMDb id (`tt…`) for anything a metadata addon knows, `kitsu:<id>` for anime with no
usable IMDb mapping.** TMDB ids are never stored: the indexer translates to `tt` and drops items without
one (`crates/index/src/tmdb.rs:148-163`). AniList and MAL ids are never stored. `anilist:<id>` is only a
display id for carousel previews (`src/lib/anime/preview.ts:6,18`), routed through handlers
(`src/screens/Anime.tsx:103-110`), and it reaches no store.

How an anime's id is chosen (`bcd0a85`): `imdbForAnime` (`src/lib/anime/search.ts:101-112`), which keeps
ani.zip's IMDb link unless none of the entry's aired episodes are in that show, and then searches Cinemeta by
title (`findImdbId`, `search.ts:138-162`). If ani.zip has only a Kitsu id, the result is `kitsu:N`
(`AnimeDetail.tsx:118-123`; TV `TvAnime.tsx:167,202-203`). The result is cached in memory only
(`["anime","imdb",id]`, `search.ts:73-81`).

| Store | Key | Where | Notes |
|---|---|---|---|
| Library | `meta_id` = `MetaPreview.id` (`tt…` or `kitsu:N`) | Rust `Space.library: HashMap<String, LibraryItem>` (`store.rs:331`), written by `library_toggle` (`commands.rs:264-280`), from `queries.ts:135-144` | From an anime page the item is `pb.meta` (`AnimeDetail.tsx:306`), the Cinemeta or Kitsu meta of whichever id was chosen at that moment. For Kitsu, the name and poster come from AniList in the title language active at the time (`kitsu.ts:52`). |
| Library removals | same id → ms | `Space.removed` (`store.rs:333`) | Never pruned. |
| Progress / history / Continue Watching | `video_id`: movie `tt…`/`kitsu:N`; episode `tt…:S:E` (Cinemeta **or TMDB** numbering) or `kitsu:N:E` (`kitsu.ts:38`) | `Space.progress: HashMap<String, Progress>` keyed by video id only (`store.rs:334`, `commands.rs:295`). Continue Watching and History group by `meta_id` (`commands.rs:315-350`) | Anime episodes of ani.zip's linked show are matched by air date (`matchVideo`, `anizip.ts:119-143`). Episodes of another show (a part IMDb lists separately) are lined up by `alignByAirDate` (`anizip.ts:170-190`). Both are stored as IMDb `S:E`. |
| Playlists | item `id` (`tt…` packed as varint; anything else UTF-8, e.g. `kitsu:N`) + type bit | localStorage `polar.playlists.<space>` (`playlists.ts:35`); server `playlists.items bytea` (`playlistCodec.ts:31-49`) | Names and posters cached locally only. |
| Downloads | video id, plus `metaId` | Rust `downloads.rs` (`downloads.ts:17-19`) | Device-only. |
| Player source filters | show id → filter and sort | `playerChoices` in `src/lib/playback/sources.ts:245` | New in `bcd0a85`. In memory, cleared when the player closes. Intentional and not synced. |
| Sync tables | `library_items (profile_id, meta_id)`; `watch_progress (profile_id, video_id)`; `playlists (id)`; `profile_settings (profile_id)` | migrations | Same strings as above. |
| In-memory anime context | video id → Kitsu alt ids / MAL+episode / filler / still | `altIds.ts:9`, `aniskip.ts:14`, `filler.ts:6`, `stills.ts:8` | Not persisted. Filled only by the desktop anime page (H6). |
| Query caches | AniList id (`["anime","media",id]`), AniList id → chosen IMDb id (`["anime","imdb",id]`), ani.zip by AniList/IMDb id | `anilist.ts`, `search.ts:73-81`, `anizip.ts:57-63`, `queries.ts:91` | Memory only. |

**Where the same show becomes separate items:**
1. **The chosen IMDb id changes.** It is recomputed every session from ani.zip, Cinemeta's episode list and
   dates, today's date (`airedEpisodes`) and whether the lookups succeeded. Examples: before vs after the
   premiere; the linked show's meta failing (the link is kept) vs succeeding (another show may be chosen);
   the search failing on desktop (falls to `kitsu:N` or nothing). Users upgrading to `bcd0a85` with progress
   on a part like HNAW under the parent show's `tt` also land here.
2. **A Kitsu id later gets an IMDb mapping, or the reverse.** The old `kitsu:N` rows stay orphaned, and the
   show appears twice in Library, Watched and Continue Watching.
3. **A franchise with some cours mapped to IMDb and some only to Kitsu.** The mapped cours collapse into one
   `tt` show, and each unmapped cour is its own `kitsu:` item.
4. **The title search** (`findImdbId`) can bind to the wrong `tt`: movies and unaired series by title and
   year ±1, airing series on as little as one date match. It can resolve differently later.
5. **TMDB key on vs off** changes the `S:E` of episode ids for the same `tt` show (`tmdb.rs:204-209`).
6. **Search dedupe** (`withoutAnime`, `search.ts:169-186`) hides Cinemeta results by title and year. It
   never merges stored records.

Nothing persists an AniList ↔ metaId mapping. A durable fix is a local and synced `aliases` table mapping
`kitsu:N`, AniList and MAL ids to the canonical id chosen at first write, read before recomputing, plus a
re-keying pass when the canonical id changes.

---

## Appendix B. Supabase data today

| Table | Column | Type | Written by / contents | Encoding / notes |
|---|---|---|---|---|
| `profiles` | `id` | uuid PK | server default | |
| | `user_id` | uuid → auth.users | default `auth.uid()` | |
| | `name` | text 1-40 | `profiles.create/update` (`supabase.ts:117-131`) | |
| | `avatar` | text, default `'blue'` | avatar id (`avatars.ts`), legacy ids normalized on read (`supabase.ts:270`) | No check. |
| | `position` | int | `profiles.length` at creation (`AccountProvider.tsx:218`) | Not unique. |
| | `created_at` | timestamptz | default | Secondary sort. |
| `library_items` | `profile_id`, `meta_id` | PK | `toLibraryRow` (`supabase.ts:274-283`); `meta_id` = `tt…` / `kitsu:N` | |
| | `user_id` | uuid | default | Redundant with the profile. |
| | `type` | text | `"movie"`/`"series"`, `''` for tombstones (`sync.rs:96`) | No check. |
| | `name` | text | title at add time; `''` for tombstones | No length limit. |
| | `poster` | text null | poster URL | |
| | `added_at` | bigint | client ms | |
| | `deleted` | bool | tombstone flag | Never purged. |
| | `updated_at` | bigint | client ms (= `added_at`, or removal time) | LWW key (client clock). |
| | `synced_at` | timestamptz | trigger `now()` | Pull cursor. |
| `watch_progress` | `profile_id`, `video_id` | PK | `toProgressRow` (`supabase.ts:295-311`) | |
| | `user_id` | uuid | default | |
| | `meta_id`, `type`, `name`, `background`, `poster` | text | title-level data copied onto every episode row | Redundant. |
| | `season`, `episode` | int null | | |
| | `episode_title` | text null | | |
| | `stream` | jsonb null | **legacy**: full `Stream` objects from older clients (URL, title, hints) | No longer written or read (`supabase.ts:15-16`). Still holds old URLs (C3). |
| | `position`, `duration` | float8 | seconds; "mark watched" writes `position = duration` (1 if unknown, `watched.ts:73-74`) | |
| | `updated_at` | bigint | client ms (`commands.rs:293,307`) | LWW key. |
| | `synced_at` | timestamptz | trigger | |
| `playlists` | `id` | uuid PK | client `crypto.randomUUID()` (`playlists.ts:99`) | Not scoped by profile in the PK. |
| | `profile_id`, `user_id` | uuid | | |
| | `name` | text 1-60 | | |
| | `items` | bytea ≤ 8192 | `encodeItems` (`playlistCodec.ts:31-49`), sent and received as the `"\x…"` hex string (`:86-94`) | Version byte, then per item a tag byte (bit 0 series, bit 1 IMDb) and either a varint of the IMDb number or varint length + UTF-8 id. Tombstones carry `items` = `[1]`. |
| | `deleted` | bool | | Counts toward the 100 limit (H4). |
| | `updated_at` | bigint | client ms (`playlists.ts:79`) | |
| | `synced_at` | timestamptz | trigger | |
| `profile_settings` | `profile_id` | uuid PK | | |
| | `user_id` | uuid | default | |
| | `data` | jsonb ≤ 16 KB | `Doc` (`settingsSync.ts:24-29`): `settings` = every `Settings` field except `metadataSource`, **including `tmdbKey`, `seekrKey`, `mdblistKey`, `omdbKey`**; `keybinds` = overrides only; `prefs` = the 17 `SYNCED_PREFS` (`prefs.ts:149-167`, now including `animePreferredGroups`); `addons` = sorted manifest URLs (**may embed service keys**) | Plain JSON, no version field. |
| | `updated_at` | bigint | `Date.now()` at push (`settingsSync.ts:122`) | |
| | `synced_at` | timestamptz | trigger | Not used by the client (`get` reads the single row). |
| `realtime.messages` (policies only) | — | — | Party broadcast/presence on `party:<CODE>`; nothing stored | Any authenticated user may join any `party:%` topic. |

Indexes: on each synced table, `(profile_id, synced_at)` for the pull and `(user_id)`. The PKs cover the
conflict targets. That is adequate, apart from the missing pagination tie-breaker (M8).

---

## Appendix C. External hosts contacted

By the Rust code, unless noted. `bcd0a85` adds no new hosts. `imdbForAnime` reaches Cinemeta or TMDB
through the existing `search`/`meta` commands. The front end also calls AniList, ani.zip, Jikan, AniSkip
and Supabase directly (lib, M10). Those aren't listed in this table.

| Host | Where | What for | Key? |
|---|---|---|---|
| Any user-installed addon host | `client.rs:48-90`; via `commands.rs:81,121,418,435`; `lib.rs:72` | manifest, catalog, meta, streams, subtitles | Often embedded in the addon URL (service tokens) |
| `opensubtitles-v3.strem.io` | `lib.rs:61` (installed at first run, `lib.rs:65-80`) | bundled subtitles addon | No |
| `v3-cinemeta.strem.io` | `cinemeta.rs:12` | catalogs, search, meta when no TMDB key; anime IMDb lookups (`imdbForAnime`) | No |
| `api.themoviedb.org` | `tmdb.rs:17` (`get` at `tmdb.rs:41-54`) | lists, discover, find, external_ids, details, seasons, recommendations | **Yes**: user's v3 key (query `api_key`) or v4 bearer; from Settings or `TMDB_API_KEY` env |
| `image.tmdb.org` | `tmdb.rs:18` | URLs only built here; the webview loads them | No |
| `api.graphql.imdb.com` | `imdb.rs:11`, used by `trailers.rs:75-78` | trailer MP4 URLs (unpublished API, web client name and UA; H12) | No |
| IMDb video CDN | URLs from `trailers.rs`; played by the webview | trailer playback | Signed URL |
| `www.animefillerlist.com` | `fillers.rs:8,25` | filler lists parsed from HTML | No |
| `api.seekr.tv` | `seekr.rs:17,95,131` | `/sprites` lookup, `/v1/keys/validate` | **Yes**: user's `X-API-Key` |
| Seekr's signed VTT host (from `vtt_url`) | `seekr.rs:105-114` | seek-preview cues | Signed URL |
| `api.introdb.app` | `introdb.rs:11,92` | intro, recap and credits segments | No |
| `api.mdblist.com`, fallback `mdblist.com/api/` | `ratings.rs:116,118` | RT, Metacritic, Letterboxd, Trakt and IMDb scores | **Yes**: user's key (query `apikey`) |
| `www.omdbapi.com` | `ratings.rs:143` | RT, Metacritic, awards, certification | **Yes**: user's key (query `apikey`) |
| Stream source hosts (CDNs, direct links) | `streamcheck.rs:39` (probe), `downloads.rs:250` (download), mpv (`player.rs:730`) | playback and downloads | Signed links or proxy headers |
| Subtitle file hosts (any) | `commands.rs:434-437` via `client.rs:83-85`; mpv `sub-add` (`player.rs:689-692`) | subtitle files | No |
| `www.youtube.com` | `commands.rs:199` | URL only, opened in the browser | No |
| The project's GitHub releases | `tauri.conf.json:45-47` (updater plugin) | `latest.json` and update downloads, minisign-verified (`tauri.conf.json:44`) | No |
| Build scripts: `github.com/shinchiro/mpv-winbuild-cmake`, `raw.githubusercontent.com/mpv-player/mpv` | `fetch-mpv.ts:13-15` | bundled mpv.exe (sha256-pinned), licence texts (unpinned) | No |
| Release scripts: GitHub API via `gh` | `release.ts:102`, `release-mac.ts:211` | publishing releases | The maintainer's gh auth |

The polar-index server binary (`bin/polar-index.rs`) calls the same TMDB and Cinemeta hosts. Bundled fonts
(`bcd0a85`) are local files passed to mpv with `--sub-fonts-dir` (`player.rs:184-193,403-405`) and
contact nothing.
