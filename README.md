<img src="assets/app-icon.svg" width="64" height="64" alt="">

# Rustio

A fast, fluid media center. It works with Stremio's addon ecosystem but is rebuilt around three things: **speed**, **episode selection**, and **the player**.

## Run it

Prerequisites: [Rust](https://rustup.rs), [Bun](https://bun.sh), and on Windows the MSVC C++ Build Tools (WebView2 ships with Windows 11).

```sh
bun install
bun run app        # Tauri dev: Rust backend + Vite HMR frontend
cargo test         # protocol, parsing and stream-ranking tests
bun run index      # optional: run the indexer as a standalone addon on :7000
```

Install a stream addon in **Settings** (any Stremio manifest URL). If you set a TMDB key (Settings → TMDB API key, or `TMDB_API_KEY`), the indexer uses TMDB. Without one it falls back to public Cinemeta, so a fresh install works immediately.

## Architecture

```
┌──────────────────────── Tauri 2 (one native process) ────────────────────────┐
│  WebView (React 19 + TanStack Query + Motion)                                │
│    screens/  Home · Discover · Search · Library · Detail · Player · Settings │
│        │  typed invoke()  (src/lib/api.ts)                                    │
│  ──────┼─────────────────────────────────────────────────────────────────── │
│  src-tauri/   commands.rs  — IPC surface, concurrent addon fan-out           │
│               store.rs     — settings, addons, library, progress (JSON)      │
│               player.rs    — external mpv fallback (embedded mpv: roadmap)   │
│        │                                │                                     │
│  crates/index  (rustio-index)     crates/addon  (rustio-addon)               │
│    our "Cinemeta": catalogs +       Stremio protocol types, lenient          │
│    full episode metadata,           client, stream quality parsing           │
│    TMDB → IMDb ids, TTL cache       and ranking                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Why Tauri.** All networking, parsing and ranking happen in Rust off the UI thread, and the window uses the system webview instead of a bundled Chromium. That keeps memory and install size at a fraction of Electron's. The UI stays in React, which makes iterating on motion and layout fast.

**rustio-index** plays the role Cinemeta plays for Stremio. It serves `trending`, `popular` and `top_rated` catalogs plus full metadata, all keyed by IMDb ids (`tt…`, episodes `tt…:season:episode`), so every existing stream addon resolves against it unchanged.
- **TMDB path:** list results are mapped to IMDb ids concurrently, and the mapping is cached. All seasons are fetched in batches of 20 using `append_to_response`.
- **Fallback:** without a TMDB key it uses Cinemeta.
- **Standalone addon:** it also runs as its own HTTP addon (`--features server`), so you can install it in Stremio too.

## The UX bets

- **Speed:**
  - **Prefetch on intent.** Resting the pointer on a poster for 120ms fetches its details. Hovering an episode or the Play button fetches its sources.
  - **Instant back.** Back navigation keeps the previous screen mounted, so scroll position and images survive.
  - **Fast first paint.** Details render immediately from the catalog preview and fill in when full metadata arrives.
  - **No slow addon blocks the rest.** Every addon is queried in parallel with an 8-second budget each.
- **Episode selection:**
  - **The primary button knows what's next.** It shows *Resume S2 · E5*, or *Play S2 · E6* once that episode is finished.
  - **The right season opens.** The detail page opens on the season you're in and marks *Up next*.
  - **Watch state at a glance.** Episodes show progress bars, watched checks and air dates; unaired episodes are dimmed.
  - **One click plays.** Clicking an episode plays the best source; the list icon on each row lets you choose a source yourself.
- **Sources:**
  - **Parsed and ranked.** Stream titles are parsed into resolution, HDR/Dolby Vision, codec, size, sources and service-cached status, then ranked and deduplicated.
  - **One clear pick.** You see a single *Best match* and the rest grouped by resolution, instead of 40 rows of emoji.
  - **Auto-fallback.** If a source fails to load, the player moves on to the next best one.
- **Player:**
  - **Custom controls.** A 1:1 scrubber with pointer capture that seeks on release, a buffered range, and a hover time bubble.
  - **Remembers its source.** It resumes from where you stopped, using the same file you were watching.
  - **Next episode built in.** An up-next card appears near the credits, the next episode's sources are preloaded at 75%, and autoplay counts down after the episode ends.
  - **Episodes and sources in place.** Both open as side panels while playback continues behind them.
  - **Keyboard first:** Space/K play, ←/→ seek, ↑/↓ volume, M mute, F fullscreen, N next, Esc back.

## Motion and design rules

The motion and design follow `.agents/skills`: apple-design, emil-design-eng, animate and animation-performance. In short:

- **Only `transform`, `opacity` and `clip-path` animate.** Progress bars use `scaleX`; the segmented control animates `clip-path`, not width or left.
- **Springs for anything you can grab.** The sheets use critically damped springs. A flick adds a small bounce and dismisses based on where the throw would land (Apple's projection function). Dragging the wrong way rubber-bands.
- **No animation for frequent actions.** Keyboard actions and tab switches are instant or near-instant. The richer motion is saved for occasional moments: opening a detail page, the up-next card.
- **Press feedback on pointer-down.** Hover effects only apply on devices with a real pointer (`hover: hover`).
- **Accessibility settings are respected:** `prefers-reduced-motion`, `prefers-reduced-transparency` and `prefers-contrast`.
- **Typography:** the system font, with letter-spacing tuned per size.

## Roadmap (blueprint → product)

- [ ] **Embedded libmpv.** Render mpv into a native surface under a transparent webview, driven by the same React controls. This covers every codec and container, plus subtitles and audio tracks.
- [ ] **Built-in p2p engine** with `librqbit`, replacing the external bridge bridge.
- [ ] **Subtitles:** OpenSubtitles addon support, plus styling and timing offset.
- [ ] **Source preferences:** maximum resolution, an HDR toggle, size caps and preferred addons. These plug into `rank::score`.
- [ ] **Remember the source per show,** so the next episode uses the same quality and release group.
- [ ] **Scrubber thumbnails, skip-intro markers, and live progressive stream results** (Tauri events) instead of all-at-once.
- [ ] **Storage and sync:** move to SQLite, add Trakt sync, and support multiple profiles.
- [ ] **Virtualized grids** for very long catalogs, and genre filters in Discover.
