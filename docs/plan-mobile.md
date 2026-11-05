# Cycle 3 plan: Polarity on Android and iOS, then the TV platforms

The third cycle (goal addendum 2026-11-05), built on the platform structure in
`docs/ARCHITECTURE.md`: the core crates and `src/lib` stay as they are, each platform fills
in its row of ARCHITECTURE §3. Tasks T-042 to T-050 in the work plan follow this document.

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
3. **Player**: libmpv (§5), built like `mpv-android`'s, drawing into a `SurfaceView` behind
   the web view, becomes an `Engine` in `player/mod.rs` reached through a Tauri mobile plugin
   (Kotlin) and makes `mpv_available` true; the front end's `MpvMedia` stays. Until it lands,
   `<video>` in Android System WebView plays MP4/WebM/HLS as the device supports.
4. **Input**: back gesture/button sends the same Back as TV mode (`dismissTop`); on-screen
   keyboard keeps search fields in view.
5. **Checks**: emulator run in CI (`reactivecircus/android-emulator-runner`) with the
   end-to-end suite of cycle 2 pointed at the app; the owner tries a real phone and tablet.
6. **Release**: AAB/APK signed with the owner's key (a CI secret the owner adds); Play Store
   listing is the owner's.

## 3. iOS and iPadOS

1. **Project**: `tauri ios init` on a Mac with Xcode; the GitHub `macos` runner builds it
   unsigned in CI.
2. **Player**: libmpv (§5) in a Metal view behind the web view (as `macos/mpv_view.m` does on
   the Mac), built as a dynamic framework if the LGPL route of §7 requires it. Until then
   WKWebView's `<video>` (AVFoundation) plays MP4/HLS with H.264/HEVC, not MKV or DTS.
3. **Shell**: same gaps as Android (`gilrs` off, downloads into the app sandbox, exclude them
   from iCloud backup).
4. **Release**: an Apple Developer account (USD 99 a year) and TestFlight; both the owner's.

## 4. TV platforms

- **Android TV**: the Android build with a leanback launcher intent, a 320x180 banner,
  `android.software.leanback` not required and touchscreen not required in the manifest, TV
  mode on at start when the device reports a TV (`UiModeManager`) through a small plugin
  command; D-pad already maps to arrow keys. Checked on the Android TV emulator.
- **Apple TV (tvOS)**: no web view and no Tauri target, so the React interface can't run.
  The plan (later, not in this cycle: §5): a native SwiftUI app that uses the core crates
  through a C binding (`uniffi` or `cbindgen`), which reuses data, identity, sources and sync
  but rebuilds every screen, with the same libmpv engine as iOS.

## 5. Owner choices (answered 2026-11-05, I-011)

- **Player: libmpv on Android and iOS**, the same formats as desktop. Its GPL/LGPL duties
  (source offer, dynamic linking on iOS, what the App Store allows) are worked out with sources
  in §7 before the engines are built (T-050); if one of them forces a choice, it goes back to
  the owner.
- **Apple TV: later.** Planned as in §4 (native SwiftUI app on the core crates through a
  binding) and not built in this cycle.
- **Unsigned builds only.** CI builds unsigned Android and iOS packages; signing keys come
  later as CI secrets, when the owner opens the store accounts (Google Play USD 25 once, Apple
  Developer Program USD 99 a year).
- Still open, asked when a release nears: app names and store identifiers (`identifier` in
  `tauri.conf.json` today).

## 6. Order

1. T-042 Android project and shell gating; app builds for the emulator in CI.
2. T-043 Android back button, keyboard, downloads folder; emulator end-to-end run.
3. T-050 libmpv licence duties on Android and iOS, with sources (§7).
4. T-044 Android libmpv engine.
5. T-045 iOS project; unsigned build on the macOS runner.
6. T-046 iOS libmpv engine and sandbox details.
7. T-047 Android TV: manifest, banner, TV mode at start; TV emulator run.
8. T-048 Apple TV: later (I-011); §4 is the plan.
9. T-049 Docs: ARCHITECTURE §3 rows to "built", `docs/unverified.md` per device, README.

## 7. libmpv licence duties (T-050, to be written)

GPL/LGPL obligations of shipping libmpv and FFmpeg on Android and iOS: which build options
keep them LGPL, the source offer, dynamic linking on iOS, and what the App Store and Google
Play terms allow, each with its primary source.
