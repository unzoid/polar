# Rewrite plan

How the code gets rewritten to be maintainable and documented without changing what Polar does
(goal 4). Built from `docs/critique.md` (ids C1-C5, H1-H17, M1-M32, L1-L24 below), in the order that
removes the most cost first. Every step is a set of small commits that each leave the checks green.

## 1. Rules for every step

- **Behaviour stays.** Every README feature keeps working. A bug fix that changes behaviour (C1, C2,
  C5, H3, H4) restores what the feature was meant to do and is listed in `docs/unverified.md` when it
  can't be run here.
- **Checks after every commit:** `bun run typecheck`, `bun run test`, `vite build`,
  `cargo test -p polar-addon -p polar-library -p polar-anime`, `cargo clippy` and `rustfmt` on those
  crates, and the legal wording grep (work NOTES). `src-tauri` and `polar-index` don't build here
  (WebKitGTK; T-012): edits there are checked by reading and rustfmt, and listed as unverified.
- **Pure logic in its own file** with a test next to the other tests (`tests/` for TS, `#[cfg(test)]`
  for Rust). Components and Tauri commands stay thin wrappers around it.
- **Comments say why**, as the code already does. Each module directory gets a short header comment in
  its entry file saying what lives there and what doesn't.
- **What is the owner's** (what accounts store, new dependencies, dropping anything) is asked first;
  the step goes on around it.

## 2. Already done

| Area | Critique ids | Where |
|---|---|---|
| Anime identity stored, not recomputed; anime context persisted | H1, H6, M6 | T-005, `docs/anime-identity.md` |
| One title page logic, one settings UI from one schema | H14, H15, M26, M27, M28 | T-019 |
| One Escape/Back stack | M25 | T-019 step 6 |
| Dead UI code, CSS tokens and primitives | M24, L23 (part) | T-019, `docs/ui-components.md` |
| P2P playback and its wording | — | T-014 |
| AniList and ani.zip share a request budget; ani.zip, lookup search and Kitsu records through the query cache | M10 | R3, `lib/net/limiter.ts` |
| Watch-party messages and presence parsed and bounded before use | M11 | R3, `lib/party/messages.ts` |

## 3. Order of the remaining work

### R1. Safety net (T-008/T-009) — data loss and blank windows first

1. **C1** `src-tauri/src/store.rs` `Store::load`, `downloads.rs`: only `NotFound` starts fresh; any other
   read error makes the store read-only for the session and says so; the backup copy's result is checked.
   The decision moves into a pure function (`load_outcome(read_result) -> Fresh | Data | ReadOnly`) with
   tests, in `crates/library` so it builds here.
2. **C4** One `ErrorBoundary` component (`components/ui`) with a Reload button: around each page
   section in `App.tsx` and `TvApp.tsx`, around `PlayerLayer`, and at the root.
3. **C5 / M29** Every query key from the `keys` factory in `lib/net/queries.ts`; the Search genre row gets
   its own key. A test asserts no two factories produce the same prefix.
4. **C2** Sign-out and profile switch: flush every cached space, not only the active one; when
   something is still unpushed, the sign-out dialog says how many changes would be lost and asks.

### R2. Sync and storage (T-010, with the compact layout of `docs/supabase-storage.md`)

Done in the same migration, so the server is changed once:

- **H2** Server clamps `updated_at` to `now() + 5 min`; push returns which rows were accepted; the
  client keeps a dirty set instead of filtering by its own clock; pulled rows are not echoed back.
- **H4** Playlist limit counts live playlists only and fires only on real inserts; `playlist_limit` is
  mapped; one failing kind no longer stops the others in `sync.ts` `run()`.
- **H5** Playlist and progress codecs: an unknown version keeps the raw bytes and the item read-only;
  never re-encode what failed to decode.
- **M8** Pull pages ordered by `(synced_at, key)`, not offset on `synced_at` alone.
- **H3 / M7** Settings: per-key merge against the last agreed document; first contact never uninstalls
  addons; restore finishes before the first sync; the size error is shown, not retried forever.
- **C3** Keys and addon URLs out of the synced settings (asked: what accounts store), legacy
  `watch_progress.stream` gone with the old table.

### R3. Front-end lib (T-007)

- **M5** One contract file per Rust command group (`lib/api/*.ts`) next to the Rust types they mirror,
  with a test that round-trips the JSON shapes the Rust tests emit (no code generator: that would be a
  new dependency). Done as a field-name contract instead of a file split: a test in each crate
  (`crates/addon`, `crates/library`, `src-tauri`, each `src/contract.rs`) serialises every type it sends the UI, every
  optional field filled, and compares the field names with `contract/<crate>.json`; `src/lib/contract.ts` lists
  the TS mirror's names per Rust type (tsc rejects a missing or extra one), and `tests/contract.test.ts` checks
  the two agree, with fields left out on purpose (`unread`) or added in TS (`added`) named. The types stay in
  `src/lib/types.ts`. Left for R4: the watched threshold's clamp is still in both `store.rs` and `lib/library/watched.ts`,
  and stream ranking is still split (Rust scores and filters; TS re-sorts, tag filters, group boost, and applies
  `preferScreenResolution`/`sourceFiltersHide`).
- **M9** Validate at the edges: AniList, ani.zip, Jikan, addon responses and pulled rows through small
  parse functions (no new library) that drop what doesn't fit instead of casting. Done for stored and pulled
  data (`lib/parse.ts`): playlists, prefs, key bindings, cached profiles, anime play context, update notes, the
  synced settings document (settings only of the kind this device has, refused values left out one by one) and
  library/progress/link/playlist/settings rows (bigint strings read as numbers, u32 fields checked). Done for remote
  answers too (`lib/anime/responses.ts`): AniList cards, pages, airing slots, franchise links and the anime page, ani.zip
  records and AniSkip times; IMDb's name search and GitHub's release notes checked in place. Addon responses are read
  by serde in `crates/addon`, so they were never cast.
- **M10** One rate limiter (`lib/net/limiter.ts`) shared by AniList, ani.zip and Jikan; 429 honours
  `Retry-After` and gives up after a bound. Done for AniList and ani.zip (Jikan moved into
  `crates/anime/src/fillers.rs`, which caps its retries). `imdbForAnime`'s Cinemeta search and `kitsuMeta`'s
  AniList record go through the query cache too (the record shared with the anime page, not a smaller query).
- **M11** Party messages parsed and bounded before use. Done (`lib/party/messages.ts`): safe-integer versions,
  a timeline only for its sender and only from someone present, at most 50 versions ahead unless from the host,
  positions/lag/text clamped, presence entries must carry their key. Ids are still self-declared (no server of
  our own): a member can claim another's id or an early `joinedAt`. **M12** Local data of a deleted profile and of
  a signed-out account removed; guest data offered to the first profile. Done: playlists, cached settings,
  unsent-link markers, last profile and recent searches forgotten; every profile's playlists pushed and counted
  before sign-out; guest playlists copied into the first profile like the library; the device's own settings kept
  aside while a profile is in use and put back at sign-out.
- **L1** Errors as `{ code, message }` from Rust and the account backend, not sniffed strings. Done: `CmdError` crosses
  IPC as `{ code, message }` (`not_found`, `unsupported`, `network`, `bad_answer`, `upstream`, `save_failed`, `source`,
  `player`, `other`); `mpv_load` and `stream_probe` use it, so the player's loading screen tells a refused source
  from mpv not starting by `code`, not wording. The UI reads every failure through `lib/errors.ts`
  (`errorMessage`, `errorCode`); the account backend maps server errors by SQLSTATE (`P0001` + the limit's name,
  no code = never answered). Silent `.catch`es that lose something asked for (mpv settings, a chosen subtitle,
  settings kept or restored at profile switch and sign-out) warn in the console; the rest (autoplay refusals,
  optional skip times) stay silent on purpose. Left: the other mpv commands still fail with a bare string, and the
  watch party's "server not set up" is still read from Realtime's wording (it sends no code).
- Layout: `lib/` keeps one folder per domain (`account`, `anime`, `party`, `settings`, `library`,
  `playback`, `net`), each with an `index.ts` that is its public surface; nothing in `lib` imports from
  `screens` or `components`. Done: `account`, `anime`, `party`, `settings` (schema, prefs, shortcuts, fonts, the
  settings search and overlay, credits), `library` (identity, playlists, watched and episode state, downloads, title
  actions), `playback` (sources, Play targets, start-up log, trailers, languages), `catalog` (shelves, calendar,
  genres, search query, recent searches, person photos, marketplace), `ui` (dismiss/layer stack, motion, viewport,
  platform, score tones) and `net` (query client, keys, queries, limiter). What every domain shares stays at the
  root: `api.ts` (Tauri commands), `types.ts`, `contract.ts`, `parse.ts`, `errors.ts`, `format.ts`, `router.tsx`,
  `updater.ts`. Code outside `src/lib` imports a folder (its `index.ts`); code inside `src/lib` and the tests import
  the file, so a barrel is never part of an import cycle and bun tests load only pure modules. `SoundPack` moved
  from `tv/sounds.ts` into `lib/settings/prefs.ts`, so nothing in `lib` imports from outside it.

### R4. Rust crates and the shell (T-009)

- **H8 / M4** Store writes debounced and off the UI thread, written to a temp file and renamed, with a
  schema version; secrets in the OS keychain stay out of scope (new dependency: asked if wanted).
  Done: `polar_library::saver` (tested) has `write_atomic` (temp file, fsync, rename, folder fsync) and
  `Saver`, a writer thread that gathers changes for 1 s and writes once; `AppState::persist` changes the
  store in memory and marks it, the thread encodes under the lock and writes outside it, `RunEvent::Exit`
  flushes. A failed write is reported by the next command until one succeeds. `polar.json` is compact
  and carries `version` (1); a file from a newer build is copied aside (`polar.v<N>-<time>.json`) before
  this one writes over it. `downloads.json` goes through `write_atomic` too. Left: settings validation and
  whole-struct `settings_set` (M4), keychain (not asked yet).
- **H9** Downloads: read timeout, resume validated with `Content-Range`, partial file kept apart.
  Done: 30 s idle timeout on the answer and on every chunk; a chunk that arrives after Pause is dropped;
  one transfer per file (a resume waits for the paused one to let go); a 206 must start where the file
  ends (`polar_addon::probe::content_range`, tested) or at 0; the file is `<name>.part` until complete,
  older partial files are picked up; a pause that lands as it finishes is completed on resume (416).
- **H10 / H11** TMDB: page-stable pagination, a concurrency limit, 429 back-off, partial results not
  cached. **L14** one shared `reqwest::Client`.
- **M1** Keys redacted from errors (the probe's redaction reused). **M13** body size caps.
  **M14** `tracing`-style logging to a rotating file (only `log` + an existing writer if it needs no new
  crate; otherwise asked). **M17** `Mutex` unwraps replaced by a poison-tolerant helper.
  M17 done: `src-tauri/src/locks.rs` (`locked()`, `reading()`, `writing()`) everywhere outside tests, and the
  index cache the same way; the `expect("http client")` constructors are left (a TLS init failure at launch).
- **M2 / M20** Capabilities and CSP narrowed to what the commands use. **M19** proxy headers on playback.
- **L18** `player.rs` split into `ipc.rs`, `autocrop.rs`, `snapshot.rs`, tests in their own module.

### R5. Screens (T-008)

- **H17** `Player.tsx` split: time-driven parts (scrubber, clock) subscribe to a store instead of
  re-rendering the whole player 4 times a second; the start-up log, tracks and options already have
  their hooks.
- **M23** Route-level code splitting (Player, Settings, TV, Anime) with `React.lazy`.
- **M32** Library sub-views in the router. **M31** the accessibility gaps listed.
- Remaining Low items folded into the files they touch (L2, L4-L7, L9-L13, L15-L17, L19, L21, L22, L24).

### R6. Documentation (T-011 at the end)

- `docs/architecture.md`: the layers (UI → lib → Tauri commands → crates; account backend seam), data
  flow of sync, where each README feature lives.
- Module header comments as in §1; README's developer section points to the docs.

## 4. Not in the rewrite

- **H12** (IMDb's private API, filler scraping): a source decision, covered by `docs/data-sources.md`
  and `docs/legal-review.md`; the code stays behind one module each so a replacement is one file.
- **M15** release pipeline: needs signing keys and GitHub; listed in `docs/unverified.md`.
- **M3** macOS media decoding: needs a Mac to check.
