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
- Android project (`src-tauri/gen/android`, T-042): generated, built in CI as a debug APK.
- Android player: libmpv (§2.3, T-044), built in CI; never run on a device yet.
- Not built: the Xcode project, signing, a player better than `<video>` on
  iOS, anything for tvOS.

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

1. **Project** (built, #29): the Xcode project isn't kept in git. CI's `ios` job on the macOS
   runner generates it (`tauri ios init --ci`, from `tauri.conf.json` and `tauri.ios.conf.json`:
   iOS 17 and later, the frameworks below), puts the app icon in and builds an unsigned IPA
   (`tauri ios build --no-sign`). On a Mac: `scripts/ios-mpv.sh <work dir> device simulator`, then
   `bun run tauri ios init` and `bun run tauri ios dev` or `build`.
2. **Player** (built, #29): libmpv inside the app, drawing through its render API with OpenGL ES
   into a view behind the web view (`src-tauri/src/ios/mpv_view.m`, the iOS twin of
   `macos/mpv_view.m`; `player/apple.rs` drives both), built as dynamic frameworks (§7). Its
   control connection is a socket pair (`--input-ipc-client`), since the app's folder paths can be
   too long for a socket file. Audio plays through an audio session for video playback (sound with
   the silent switch on). Drawing stops while the app is in the background. Without the framework,
   WKWebView's `<video>` (AVFoundation) plays MP4/HLS with H.264/HEVC, not MKV or DTS.
3. **Shell** (built): `gilrs` off; downloads stay in the app's own folder, excluded from iCloud
   and computer backups (`src-tauri/src/ios/files.m`).
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
  (source archives, dynamic linking on iOS) are set out in §7 (T-050).
- **Apple TV: later.** Planned as in §4 (native SwiftUI app on the core crates through a
  binding) and not built in this cycle.
- **Unsigned builds only.** CI builds unsigned Android and iOS packages (Android: a debug APK and an
  unsigned release APK and bundle); signing keys come
  later as CI secrets, when the owner opens the store accounts (Google Play USD 25 once, Apple
  Developer Program USD 99 a year).
- Still open, asked when a release nears: app names and store identifiers (`identifier` in
  `tauri.conf.json` today).

## 6. Order

1. T-042 Android project and shell gating; app builds for the emulator in CI.
2. T-043 Android back button, keyboard, downloads folder; emulator run (built: Back through `onBackButtonPress`
   as Escape, Home, then leave; the web view ends at the keyboard; no "Show in Folder" off desktop; the
   emulator smoke test `e2e/android/smoke.sh` in `e2e-app.yml`, not the whole e2e suite, which needs a
   WebDriver into the WebView).
3. T-050 how libmpv and FFmpeg are built on Android and iOS (§7).
4. T-044 Android libmpv engine (built: `player/android.rs` loads libmpv from the APK and draws into a
   `SurfaceView` behind the web view (`MainActivity.kt`), driven over the same IPC socket as on desktop;
   `scripts/android-mpv.sh` builds it in CI with the sources archive; never run on a device yet).
5. T-045 iOS project; unsigned build on the macOS runner (built, #29: generated in CI, §3).
6. T-046 iOS libmpv engine and sandbox details (built, #29: §3, §7; never run on a device yet).
7. T-047 Android TV: manifest, banner, TV mode at start (built: a `polarDevice` JavaScript interface from
   `MainActivity.kt` instead of a plugin command, so the answer is there before the first script runs); TV emulator run left.
8. T-048 Apple TV: later (I-011); §4 is the plan.
9. T-049 Docs: ARCHITECTURE §3 rows to "built", `docs/unverified.md` per device, README.

## 7. How libmpv and FFmpeg are built on Android and iOS (T-050)

| Platform | mpv | FFmpeg | TLS | Linking |
|---|---|---|---|---|
| Android | as `mpv-android` builds it (GPL) | `--enable-gpl --enable-version3` | mbedTLS | shared libraries in the APK |
| iOS, iPadOS | `-Dgpl=false` (LGPLv2.1+) | without `--enable-gpl` or `--enable-version3` (LGPLv2.1+) | Secure Transport | each LGPL library (mpv, FFmpeg's, libplacebo, FriBidi) a dynamic framework of its own, the others (dav1d, libass, FreeType, HarfBuzz) static inside them; embedded and signed by Xcode, libmpv loaded at run time (`scripts/ios-mpv.sh`) |

Each release, on both platforms, carries:

- the source archives of the exact mpv, FFmpeg and library versions it bundles, the configure
  lines, any `changes.diff`, and what's needed to build them;
- the licence texts, and the notices in Settings → About → Credits, as `scripts/fetch-mpv.ts`
  does for Windows (see `docs/licensing.md`);
- on iOS, a licence agreement for the app that allows modifying the LGPL parts and reverse
  engineering to debug such changes.

FFmpeg's `cropdetect` filter is a GPL part, so the iOS build has none. Autocrop there uses
Polarity's own black-bar detector (MIT, `crates/player`, fed every frame in memory through mpv's
`screenshot-raw`, as on macOS: `Tune::cropdetect` is off on both), written from the idea, not
from FFmpeg's `vf_cropdetect.c`. It smooths over
time and locks on fast, and is measured against `cropdetect` on the same clips (time to first
crop, crop changes per minute, wrong crops) to decide whether it replaces `cropdetect` on
desktop too. The audio presets (`tune.rs`: `pan`, `dynaudnorm`) are LGPL parts and work on
both builds.

Primary sources: mpv's `Copyright` file, FFmpeg's `LICENSE.md` and https://ffmpeg.org/legal.html,
`mpv-android`'s `buildscripts/scripts/ffmpeg.sh` and `mpv.sh`.
