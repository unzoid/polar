# Architecture

How Polar is put together, where platform code may live, and what each platform it
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
```

Rules:

- **The core crates hold no platform code.** They build and test on any system with
  `cargo test -p polar-addon -p polar-library -p polar-anime -p polar-index -p polar-player`. Their only
  `cfg` outside tests is `#[cfg(unix)]` in `crates/library/src/saver.rs`, which makes
  `polar.json` owner-only (0600) where the system has Unix permissions; elsewhere it does
  nothing. Paths come in from the shell (`app_data_dir`, `app_cache_dir`), never from the
  crates themselves.
- **Only `src/lib/platform` imports `@tauri-apps/*`.** Everything else goes through its
  interfaces. `tests/platformBoundary.test.ts` fails if another file does.
- **Platform differences in the shell stay in the module that owns the concern** (the
  player in `player.rs` and `macos/`, controllers in `controllers.rs`), behind the commands
  the front end already calls, so a new platform changes that module and nothing above it.

## 2. One interface per concern

| Concern | Front end (`src/lib/platform` unless named) | Native side | How it differs by platform |
|---|---|---|---|
| Bridge | `bridge.ts`: `call(command, args)`, `on(event, handler)`, `inShell` | `tauri::generate_handler!` in `src-tauri/src/lib.rs` | Tauri carries it everywhere; nothing differs |
| Player | `components/player/mpvMedia.ts` (`MpvMedia`, the same shape as `<video>`), chosen in `screens/Player.tsx` by `mpv_available` | `player.rs` (`mpv_*` commands, `Engine`), `macos/mpv_view.m`, `streamcheck.rs`; what any engine follows in `crates/player` (allow-lists, `Tune`, `CropTracker`/`zoom_for`) | Windows: mpv process drawing into the window (`--wid`). macOS: libmpv in the app. Elsewhere `mpv_available` is false and the webview's `<video>` plays |
| Storage | `lib/settings/prefs.ts` (device prefs in `localStorage`), `lib/api.ts` for the rest | `store.rs` + `polar_library::saver` (`polar.json` in the app data folder), `downloads.rs` | Tauri picks the folders (`app_data_dir`, `app_cache_dir`) per system |
| Keys | `lib/account/secrets.ts` (sealed sync, off by default) | `polar.json` (`store.rs`), owner-only on Unix | Desktop: a file only the user can read. Phones/TV: the app's private storage |
| Window | `window.ts`: `AppWindow` (minimise, maximise, close, fullscreen, focus, resize, zoom) | Tauri window, `tauri.conf.json`, `tauri.macos.conf.json`, `tauri.windows.conf.json` | Windows/Linux draw our buttons (`components/WindowControls.tsx`), macOS keeps its traffic lights; on phones and TVs the window is the screen |
| Input | keyboard and pointer in the webview; `tv/gamepad.ts` (Gamepad API + native hot-plug); `lib/settings/keybinds.ts` | `controllers.rs` (gilrs: hot-plug only) | ⌘ vs Ctrl (`device.ts` `MOD`); TV remotes send arrow keys and Back, which TV mode already uses |
| Updates | `updates.ts`: `AppUpdates` (`canUpdate`, `version`, `check`, `relaunch`); state in `lib/updater.ts` | `tauri-plugin-updater` + `tauri-plugin-process`, desktop only (`src-tauri/Cargo.toml`, `#[cfg(desktop)]` in `lib.rs`) | Desktop updates itself from the signed `latest.json`; app stores update phone and TV builds, so `canUpdate` is false there |
| Device | `device.ts`: `os`, `osName`, `isMac`, `isDesktop`, `MOD`, `MOD_LABEL`; `formFactor.ts`: `formFactor()`, `onFormFactor` (phone, tablet or desktop, touch; §4) | — | Read from the webview's navigator and screen (`detectOs`, `formFactorOf`, tested in `tests/device.test.ts`, `tests/formFactor.test.ts`) |

## 3. What each platform provides

"Built" means the code is in the tree; nothing here was run on a real device from this
machine (see `docs/unverified.md`).

| Platform | Shell | Player | Storage and keys | Window | Input | Updates | State |
|---|---|---|---|---|---|---|---|
| Windows | Tauri 2, WebView2 | mpv process in the window (bundled by `scripts/fetch-mpv.ts`), `<video>` without it | `polar.json` in `%APPDATA%` (Tauri's app data folder) | frameless, our buttons | keyboard, mouse, controllers (gilrs: XInput / Windows.Gaming.Input) | self-update, quiet installer | built |
| macOS | Tauri 2, WKWebView | libmpv inside the app (`macos/mpv_view.m`) | app data folder, 0600 | transparent title bar, system traffic lights | keyboard (⌘), trackpad, controllers (gilrs: IOKit) | self-update | built |
| Linux | Tauri 2, WebKitGTK | `<video>` only: mpv can't draw into a GTK window yet, so `mpv_available` is false | XDG data folder, 0600 | our buttons | keyboard, mouse, controllers (gilrs: evdev) | self-update for an AppImage install, if a release carries one | built; mpv embedding not built |
| Android (phone, tablet) | Tauri 2 mobile, Android System WebView (`mobile_entry_point` in `lib.rs`) | `<video>` (the WebView's decoders); an mpv/libmpv or ExoPlayer view is cycle 3 work | app-private storage | the whole screen | touch; keyboard and controllers through the WebView | Play Store / sideload; `canUpdate` false | not built: no Android project generated (`tauri android init`); phone and tablet layouts built (§4), not yet seen on a device |
| iOS, iPadOS | Tauri 2 mobile, WKWebView | `<video>` (AVFoundation: HEVC yes, MKV/AC3/DTS no); a libmpv view is cycle 3 work | app sandbox | the whole screen | touch; controllers through the Gamepad API | App Store; `canUpdate` false | not built: no Xcode project; phone and tablet layouts built (§4), not yet seen on a device |
| Android TV | the Android build with a leanback launcher entry | as Android | as Android | fullscreen, TV mode on by default | remote D-pad as arrow keys, Back, controllers | Play Store | not built; TV mode (`src/tv`) is the interface it would use |
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
   plugins as `src-tauri/Cargo.toml` already does for the updater.
2. If the player can do better than `<video>`, give `player.rs` an engine for it (reusing
   `crates/player`'s rules) and make `mpv_available` say so; the front end needs no change.
3. Add the system to `Os` in `src/lib/platform/device.ts` if it has to be told apart.
4. Fill in its row in §3 and what can't be checked in `docs/unverified.md`.
