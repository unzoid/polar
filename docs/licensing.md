# Licensing

Polarity plays HTTP links and YouTube ids. It has no peer-to-peer playback and ships no third-party
stream add-ons; add-ons are chosen and installed by the user.

| Part | Licence | Where |
|---|---|---|
| Polarity itself | MIT | `LICENSE` |
| OpenDyslexic font | SIL Open Font License 1.1 | `src/assets/fonts/OFL.txt`, `src-tauri/fonts/OFL.txt` |
| Avatars (DiceBear) | Designs CC0, code MIT | `@dicebear/*` in `package.json` |
| mpv (desktop player) | GPL-2.0-or-later | Windows: `licenses/mpv/` in the app (`LICENSE.GPL.txt`, `COPYRIGHT.txt`, fetched by `scripts/fetch-mpv.ts`); macOS: `licenses/` in the app, with `BUNDLED.txt` naming each bundled library's build and where its source is (`scripts/bundle-libmpv.ts`) |
| FFmpeg (inside mpv) | GPL, as built into mpv | With mpv's, above |
| libmpv and FFmpeg (Android player) | GPL-3.0-or-later as built (FFmpeg `--enable-gpl --enable-version3`), with the libraries they link (mbedTLS, dav1d, libass, libplacebo, …) | In the APK: `assets/licenses/mpv/` (mpv's and FFmpeg's licence texts, `BUNDLED.txt` naming each library's version; the NDK's `libc++_shared.so`, Apache-2.0 WITH LLVM-exception, which libmpv links, with its notices in `libc++-NOTICE.txt`). Sources: `polarity-android-mpv-sources.tar.xz`, made by `scripts/android-mpv.sh` with the build (CI artifact `android-mpv-sources` next to the APK), with every source, mpv-android's build scripts and `SOURCES.txt`; it is published with every release that carries an APK |
| npm and Rust dependencies | Each package's own | `bun.lock`, `Cargo.lock` |

Third-party logos (TMDB's in Settings → About → Credits) are shown only as credits and links to
those services, following their guidelines.

What the project doesn't accept: see `AGENTS.md` and `CONTRIBUTING.md`.
