# Testing

Five layers, from fast to slow. All but the last run on every push in CI
(`.github/workflows/ci.yml`); the app smoke test runs nightly and on `master`
(`.github/workflows/e2e-app.yml`). Why each layer exists and what it covers:
[plan-tests.md](plan-tests.md). Test data is invented or openly licensed; no
test uses a real account, key or add-on, and none needs a secret.

| Layer | Where | Run it | CI job |
|---|---|---|---|
| Unit (TypeScript) | `tests/*.test.ts` | `bun run test` | `frontend` |
| SQL (migrations, codec, row-level security) | `tests/sql` (PGlite) | part of `bun run test` | `frontend` |
| Components with a DOM | `tests/dom` (happy-dom) | `bun run test:dom`, also part of `bun run test` | `frontend` |
| Rust unit and integration | `#[cfg(test)]` in each crate, `crates/addon/tests`, `src-tauri/src/downloads.rs` | `cargo test --workspace` | `rust` (Linux, Windows, macOS) |
| End to end, web build | `e2e/*.spec.ts` (Playwright) | `bun run e2e` | `e2e-web` |
| End to end, real app | `e2e/app/smoke.ts` (tauri-driver) | `bunx tauri build --debug --no-bundle`, then `bun run e2e:app` | `e2e-app` (nightly, `master`) |
| Android emulator smoke | `e2e/android/smoke.sh` (adb: install, start, 30 s alive, Back, no crash) | `bun run tauri android build --debug --apk --target x86_64`, an emulator running, then `e2e/android/smoke.sh <apk>` | `e2e-app` job `android` (logcat and screenshots kept as `android-emulator-smoke`) |

Also on every push: `bun run build` (which type-checks), `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets -- -D warnings`, and the Android app built as a debug APK
for the emulator and for phones (job `android`; the APK is kept for 14 days as `android-debug-apk`). Before a pull request run at least
`bun run typecheck`, `bun run test` and `cargo test --workspace`.

## Unit tests (TypeScript)

`bun test` with no DOM: pure functions in `src/lib` (codecs, merges, identity, settings
schema, request headers, start-up log...). One file per module, named after it, importing the
module's file directly (not the `lib/<domain>` barrel). Some tests hold invariants of the
whole tree rather than one module: `platformBoundary.test.ts` (only `src/lib/platform`
imports `@tauri-apps`), `webviewPolicy.test.ts` (every host the front end fetches is in the
web view's `connect-src`), `contract.test.ts` (front-end types against `contract/*.json`).

## SQL tests

`tests/sql/compactStorage.test.ts` loads `supabase/migrations` into PGlite (Postgres in
WebAssembly) with the small Supabase stand-in in `supabaseStub.ts` (roles, `auth.uid()`), then
checks the SQL codec against the TypeScript one, `sync_lww`, row-level security, size limits,
`supabase/checks` and the optional per-episode scripts. The tests share one database and run in
order. A new migration needs no wiring: add a test for what it changes. Row-level security on a
real project is still the owner's check (`supabase/checks`, [unverified.md](unverified.md)).

## Component tests

`tests/dom` runs in its own `bun test` with `tests/dom/setup.ts` preloaded, which installs
happy-dom's globals (kept apart so the plain unit tests run without a DOM). `render.tsx` has
`render`, `press`, `click` and finders by text. Test what a person does: press keys, click,
read text and ARIA state; not class names.

## Rust tests

Each crate keeps unit tests next to its code. Worth knowing:

- `crates/addon/tests/addon_server.rs`: the add-on client against a local HTTP server
  (manifest, catalogs, meta, streams, subtitles, redirects, errors, size cap).
- Each crate's `contract.rs` test writes `contract/<crate>.json` (the JSON the front end sees);
  a changed file is a changed contract, so commit it with the change. `contract/error-codes.json`
  holds the error codes on both sides.
- `src-tauri` tests need the platform's web view libraries to build (WebKitGTK on Linux), so
  `cargo test --workspace` on a machine without them fails at `polar`; test the core crates with
  `cargo test -p polar-addon -p polar-anime -p polar-index -p polar-library -p polar-player -p polar-torrent`.

## End to end, web build

`playwright.config.ts` starts the Vite dev server and opens `fake.html`, where
`src/lib/platform/fake` stands in for the native shell, with titles from
`src/lib/platform/fake/fixtures.ts`. `e2e/fixtures.ts` gives each test an `app` page that
refuses every outside host (`media.example` answers with a silent WAV made by `e2e/media.ts`)
and fails on any uncaught page error. Projects: `desktop` (Chromium; `desktop-webkit` too unless
`POLAR_E2E_CHROMIUM` is set), `phone` (`phone.spec.ts`, Pixel 7) and `tv` (`tv.spec.ts`, keys
only). One project: `bun run e2e --project=phone`. First time: `bunx playwright install chromium
webkit`; where that can't download, `POLAR_E2E_CHROMIUM=<path to chrome>` uses another
Chromium. Reports and traces go to `e2e/.report` and `e2e/.results` (ignored; CI keeps them when
a test fails).

A new screen or feature in the fake shell needs its fixture data in `fake/fixtures.ts` and the
command in `src/lib/platform/fake`; a test then finds things by role and name as a person would.

**Worst-case data.** `fake.html?worst=1` (or `localStorage["polar.fakeWorst"] = "1"`) swaps the fixtures for
the data that breaks layouts: a 117-character title, one-letter, Japanese, Arabic, emoji and HTML-looking names,
missing art, years and ratings, 41 seasons and episode 9999, 1284-minute runtimes, 40 sources with huge, tiny
and missing sizes and many tags, long add-on and cast names. `?worst=empty` empties the library, history,
add-ons, sources and search instead. Look at a new screen with both before it ships.

## End to end, real app

`e2e/app/smoke.ts` drives the debug build through `tauri-driver`, with a small WebDriver client
of its own (no test framework): start without an account, turn Skip intros on, add a title
through the command bridge, quit with the window's Close button, start again and find both still
there (the store on disk and the web view's storage). Ending the WebDriver session instead kills
the app before it writes what is still pending at exit. If the click doesn't end the app, the
script clicks the button from the page, then closes the window through the bridge, and warns which
one did (on Linux it watches the app's process, not the window). It needs `cargo install tauri-driver --locked` and the platform's
driver: `webkit2gtk-driver` on Linux (`xvfb-run -a bun run e2e:app` without a display), an
msedgedriver of the WebView2 version on Windows. macOS has no driver for its web view. On Linux
the app's data goes to a fresh folder; on Windows it can't be moved, so the script runs there only
on CI or with `POLAR_E2E_APP_OK=1`, and writes into your own profile. GitHub's Windows runners
run elevated, and WebView2 150 and later ignore the driver's `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
in an elevated process, so on Windows the main window is created in `setup` and a debug build
passes those arguments and the driver's profile folder through the WebView2 API
(`src-tauri/src/automation.rs`); release builds use the config alone.

Not covered by any layer yet: the player with mpv (needs a desktop, [desktop test](unverified.md)),
sign-in and sync against a real Supabase project, and the real add-ons and metadata services.

## Security checks

`.github/workflows/security.yml`, apart from the test layers above:

| Check | When | Fails on | Run it |
|---|---|---|---|
| Licences, crate sources, bans (cargo-deny, `deny.toml`) | every push and pull request | a crate under a licence `deny.toml` doesn't allow, or from anywhere but crates.io | `cargo install cargo-deny --locked`, then `cargo deny check licenses sources bans` |
| Advisories (OSV-Scanner on `Cargo.lock`, `bun.lock`, `web/bun.lock`, `fuzz/Cargo.lock`) | every push and pull request | high or critical advisories only (CVSS 7.0 or more, or rated so by GitHub); others are listed in the job summary | `osv-scanner scan --format=json --output=osv.json --lockfile=Cargo.lock --lockfile=bun.lock`, then `bun scripts/advisoryGate.ts osv.json` |
| Advisories (`bun audit`) | every push and pull request | high or critical | `bun audit --audit-level=high` |
| CodeQL, TypeScript and Rust | pushes to `master`, Mondays, by hand | nothing: results go to the repository's Security tab | — |
| Fuzzing (`fuzz/`, cargo-fuzz) | nightly, by hand (seconds per target as input) | a crash; the input that caused it is kept as the artifact `fuzz-crash-<target>` | `cargo install cargo-fuzz --locked`, then `cargo +nightly fuzz run <target> -- -max_total_time=60` |

The fuzz targets feed random bytes to what reads outside data: an add-on's JSON answers
(`addon_response`), subtitle files (`subtitles`), a torrent stream's hash and sources (`magnet`),
the autocrop probe's screenshots and links passed to mpv (`player_input`), and the library file
and file names from titles (`library_file`). They check that nothing panics, overflows or runs out
of memory. To replay a crash: `cargo +nightly fuzz run <target> <artifact file>`; a fixed crash
becomes a unit test in the crate. `fuzz/` is its own Cargo workspace with its own `Cargo.lock`, so
the app's builds never compile libFuzzer.
