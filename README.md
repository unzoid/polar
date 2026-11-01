# Polar

A desktop app for browsing shows and movies and playing streams from Stremio-supported addons.

![Home](readme-images/image%20(4).png)

## Screenshots

TV mode

![TV mode](readme-images/image%20(5).png)

Player

![Player](readme-images/image%20(7).png)

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
