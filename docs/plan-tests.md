# Cycle 2 plan: tests for what is vital, CI on every push

The second cycle after the rewrite (goal addendum 2026-11-05). It adds no features: it makes
the parts whose failure would cost users data, playback or their account checked on every
push. Tasks T-035 to T-041 in the work plan follow this document.

## 1. Where things stand

- **Unit tests**: 31 files in `tests/` (`bun test tests`) cover the front-end lib (identity,
  codecs, settings docs, secrets, query keys, limiter, party messages, form factor, the
  platform boundary); 94 `#[test]`s in the crates and `src-tauri` (sync merge, identity,
  saver, add-on parsing and probe, player rules, anime ids).
- **Contract**: `contract/*.json` and `tests/contract.test.ts` keep TS and Rust field names in
  step.
- **SQL**: the migrations are checked only by a PGlite script outside the repo
  (`work/tmp/pgcheck/compact.ts`, 29 checks) and by `supabase/checks/compact_storage.sql`,
  which the owner runs by hand against a real project.
- **CI** (`.github/workflows/ci.yml`): runs on pushes to `master` and on pull requests only:
  front end (tests + `tsc` + `vite build`) on Ubuntu, `cargo test`/clippy for the whole
  workspace on Windows and macOS, `cargo fmt --check`. Linux does not build `src-tauri` (no
  WebKitGTK installed on the runner), no SQL runs, nothing runs a screen.
- **Not tested anywhere**: screens and components (no DOM in the tests), the Rust commands
  as the front end calls them, the add-on client against an HTTP server, the migrations
  against Postgres in CI, the app window.

## 2. What is vital

Ranked by what a failure costs a user:

1. **Account data**: sync merge (library, progress, anime links, settings docs), the
   migrations and their SQL codec, sign-out pushing every profile, `polar.json` saving and
   reading (a broken file must never be overwritten).
2. **Playback**: picking and probing a stream, the add-on protocol, resume position, next
   episode, the mpv allow-lists (what the web view may ask the player to do).
3. **Identity**: one item per show in search, library, history and Continue Watching.
4. **Secrets**: keys and add-on links never leave the device unless sealed; the sealed format
   opens with the right passphrase only.
5. **The shell starts**: the window opens, the first screen renders, an error boundary catches
   a crash.

## 3. The test layers

| Layer | Tool | What it covers | Runs where |
|---|---|---|---|
| Unit, TS | `bun test` (in place) | lib functions, codecs, reducers | every push, Ubuntu |
| Unit, Rust | `cargo test` (in place) | crates, `src-tauri` pure modules | every push, Ubuntu (core crates), Windows, macOS |
| Components | `bun test` + a DOM (`happy-dom`, new dev dependency) + React's `act` | shared components (`Button`, `Dialog`, menus, `SettingRow`), the dismiss stack, error boundaries, the player start-up screen | every push, Ubuntu |
| Integration, SQL | Postgres in CI: PGlite (new dev dependency, no Docker) or `supabase start` (Supabase CLI + Docker) | every migration from empty, the compact codec, `sync_lww`, row-level security (one user can't read another's rows), the optional per-episode scripts, `supabase/checks` | every push, Ubuntu |
| Integration, Rust | `cargo test` with a local HTTP server (`tokio` + `axum`, already in the tree behind `polar-index`'s `server` feature) | add-on client: manifests, catalogs, streams, size caps, redirects, errors without URLs; probe events; downloads resume (`Content-Range`) | every push |
| Integration, bridge | Rust tests calling the command functions with a test `AppState` | the commands' JSON matches `contract/` and their errors map to `CmdError` codes | every push, Windows/macOS (Linux once WebKitGTK is installed in CI) |
| End to end, web | Playwright (new dev dependency) against `vite preview` with a fake bridge (`src/lib/platform` swapped for a test double that answers commands from fixtures) | start, home, search, title page, add to library, play (with `<video>` on an openly licensed test file), settings, TV mode with arrow keys, phone width | every push, Ubuntu (Chromium + WebKit) |
| End to end, app | `tauri-driver` (WebDriver) on Linux and Windows; macOS has no WKWebView driver | the real shell opens, store round-trip, player falls back to `<video>` | nightly and on `master`, not every push (slow) |

Test data is invented or openly licensed (`docs/screenshots.md` lists the films);
no real account, key or add-on is used in CI.

## 4. CI changes

- Trigger on **every push** to every branch (goal) and on pull requests; keep the
  `concurrency` rule.
- Ubuntu job installs WebKitGTK (`libwebkit2gtk-4.1-dev`, `libsoup-3.0-dev`,
  `libayatana-appindicator3-dev`) so the whole workspace builds and tests there too.
- New jobs: `sql` (migrations + checks), `e2e-web` (Playwright), nightly `e2e-app`
  (tauri-driver). Playwright reports and screenshots kept as artifacts on failure only.
- Keep `permissions: contents: read` and SHA-pinned actions (dependabot already updates them);
  no secrets are needed by any job.
- A coverage report (`bun test --coverage`, `cargo llvm-cov`) is printed, not enforced.

## 5. Owner choices (answered 2026-11-05, I-010)

- New dev dependencies: `happy-dom`, `@playwright/test` and `@electric-sql/pglite` (MIT or
  Apache-2.0), dev only. PGlite, not Docker, for the SQL checks; row-level security is still
  checked by the owner against a real project (`supabase/checks`).
- The app end-to-end job (tauri-driver) runs nightly and on `master`; everything else on every
  push.

## 6. Order

1. T-035 CI on every push, Linux builds the whole workspace.
2. T-036 SQL integration: the PGlite checks move into the repo (`tests/sql/`) and run in CI.
3. T-037 Rust integration: local add-on server, downloads, command JSON.
4. T-038 Component tests with a DOM.
5. T-039 Fake bridge + Playwright end-to-end on the web build.
6. T-040 tauri-driver app smoke test (nightly).
7. T-041 Docs: `docs/testing.md` (how to run each layer, how to add a test), README
   Contributing section, `docs/unverified.md` updated with what CI now checks.
