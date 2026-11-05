# Cycle 3 plan: Polar on Android and iOS, then the TV platforms

The third cycle (goal addendum 2026-11-05), built on the platform structure in
`docs/ARCHITECTURE.md`: the core crates and `src/lib` stay as they are, each platform fills
in its row of ARCHITECTURE §3. Tasks T-042 to T-049 in the work plan follow this document.

## 1. What is already in place

- Core crates free of platform code; `src-tauri` gates the updater and process plugins off
  Android and iOS (`src-tauri/Cargo.toml`) and has `mobile_entry_point` (`lib.rs`).
- `src/lib/platform` is the only front-end code that touches Tauri; `canUpdate` is false on
  phones and TVs; `mpv_available` is false where mpv can't embed, so `<video>` plays.
- Phone and tablet layouts (`formFactor.ts`, `data-form`/`data-touch`, bottom tab bar, safe
  areas, 44 px targets) and TV mode (`src/tv`, arrow keys, one Back stack).
- Not built: the Android and Xcode projects, signing, a player better than `<video>` on
  mobile, anything for tvOS.

## 2. Android (phones and tablets) first

1. **Project**: `tauri android init` (Android SDK + NDK, Java 17); the generated
   `src-tauri/gen/android` is committed without signing files. Build `aarch64` and `x86_64`
   (emulator) targets.
2. **Shell gaps**: `gilrs` hot-plug (no Android backend, gate it off; controllers reach the
   WebView's Gamepad API), `tauri-plugin-opener` (works on Android), downloads to the app's
   own folder, `polar.json` in app-private storage (no 0600 needed there).
3. **Player**: `<video>` in Android System WebView plays MP4/WebM/HLS with H.264/HEVC/VP9/AV1
   as the device supports; MKV with AC3/DTS and image subtitles won't. A native engine is the
   owner's choice (§5): libmpv (`mpv-android`'s build, GPL/LGPL) in a `SurfaceView` behind the
   web view, or Media3 ExoPlayer (Apache-2.0, plus FFmpeg extension for AC3/DTS). Either one
   becomes an `Engine` in `player.rs` reached through a Tauri mobile plugin (Kotlin), and makes
   `mpv_available` (renamed `native_player`) true; the front end's `MpvMedia` stays.
4. **Input**: back gesture/button sends the same Back as TV mode (`dismissTop`); on-screen
   keyboard keeps search fields in view.
5. **Checks**: emulator run in CI (`reactivecircus/android-emulator-runner`) with the
   end-to-end suite of cycle 2 pointed at the app; the owner tries a real phone and tablet.
6. **Release**: AAB/APK signed with the owner's key (a CI secret the owner adds); Play Store
   listing is the owner's.

## 3. iOS and iPadOS

1. **Project**: `tauri ios init` on a Mac with Xcode; the GitHub `macos` runner builds it
   unsigned in CI.
2. **Player**: WKWebView's `<video>` (AVFoundation) plays MP4/HLS with H.264/HEVC, not MKV,
   AC3 in most containers or DTS. Better playback means libmpv (MPVKit) in a Metal view or
   VLCKit; both are LGPL/GPL and need care with App Store rules (§5).
3. **Shell**: same gaps as Android (`gilrs` off, downloads into the app sandbox, exclude them
   from iCloud backup).
4. **Release**: an Apple Developer account (USD 99 a year) and TestFlight; both the owner's.

## 4. TV platforms

- **Android TV**: the Android build with a leanback launcher intent, a 320x180 banner,
  `android.software.leanback` not required and touchscreen not required in the manifest, TV
  mode on at start when the device reports a TV (`UiModeManager`) through a small plugin
  command; D-pad already maps to arrow keys. Checked on the Android TV emulator.
- **Apple TV (tvOS)**: no web view and no Tauri target, so the React interface can't run.
  Options (§5): a native SwiftUI app that uses the core crates through a C binding
  (`uniffi` or `cbindgen`), which reuses data, identity, sources and sync but rebuilds every
  screen; or leave tvOS out until a supported web runtime exists. This is the largest single
  item in the cycle and is planned last.

## 5. Owner choices (asked through the inbox)

- Native player per platform: libmpv (same as desktop, GPL/LGPL obligations) or the
  platform players (ExoPlayer, AVPlayer: fewer formats, simpler licences), or `<video>` only
  for the first release.
- Accounts and costs: Google Play developer account (one-off USD 25), Apple Developer
  Program (USD 99 a year); signing keys stay with the owner and reach CI as secrets.
- Apple TV: native SwiftUI app on the core crates, or not now.
- App names and store identifiers (`identifier` in `tauri.conf.json` today).

## 6. Order

1. T-042 Android project and shell gating; app builds for the emulator in CI.
2. T-043 Android back button, keyboard, downloads folder; emulator end-to-end run.
3. T-044 Android native player (per the owner's answer).
4. T-045 iOS project; unsigned build on the macOS runner.
5. T-046 iOS player and sandbox details (per the owner's answer).
6. T-047 Android TV: manifest, banner, TV mode at start; TV emulator run.
7. T-048 Apple TV per the owner's answer (binding + native app, or recorded as not now).
8. T-049 Docs: ARCHITECTURE §3 rows to "built", `docs/unverified.md` per device, README.
