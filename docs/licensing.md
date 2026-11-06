# Licensing

Polarity plays HTTP links and YouTube ids. It has no peer-to-peer playback and ships no third-party
stream add-ons; add-ons are chosen and installed by the user.

| Part | Licence | Where |
|---|---|---|
| Polarity itself | MIT | `LICENSE` |
| OpenDyslexic font | SIL Open Font License 1.1 | `src/assets/fonts/OFL.txt`, `src-tauri/fonts/OFL.txt` |
| Avatars (DiceBear) | Designs CC0, code MIT | `@dicebear/*` in `package.json` |
| mpv (desktop player) | GPL-2.0-or-later | Windows: `licenses/mpv/` in the app (`LICENSE.GPL.txt`, `COPYRIGHT.txt`, FFmpeg's texts and `BUNDLED.txt`, listing every library in `mpv.exe` at its commit); `mpv.exe` is built in CI by `scripts/windows-mpv.sh` from shinchiro's mpv-winbuild-cmake with every library pinned in `scripts/windows-mpv.lock`, and every Windows release attaches the exact sources as `Polarity_<version>_x64_mpv-sources.tar` (`scripts/fetch-mpv.ts`, `scripts/release.ts`); macOS: `licenses/` in the app, with `BUNDLED.txt` naming each bundled library's build and where its source is (`scripts/bundle-libmpv.ts`) |
| FFmpeg (inside mpv) | GPL, as built into mpv | With mpv's, above |
| npm and Rust dependencies | Each package's own | `bun.lock`, `Cargo.lock` |

Third-party logos (TMDB's in Settings → About → Credits) are shown only as credits and links to
those services, following their guidelines.

What the project doesn't accept: see `AGENTS.md` and `CONTRIBUTING.md`.
