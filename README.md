# Polar

A desktop app for browsing shows and movies and playing streams from Stremio addons.

## Run locally

You’ll need [Rust](https://rustup.rs), [Bun](https://bun.sh), and on Windows the MSVC C++ Build Tools.

```sh
bun install
bun run app
```

To run the optional catalog addon:

```sh
bun run index
```

Add a Stremio addon URL in Settings. You can also add a TMDB API key there; without one, the catalog uses Cinemeta.
