# Polarity website

SolidJS + Tailwind pages, with one Elysia route (`/api/release`) that reads the latest GitHub release.
Hosted on Cloudflare Workers: Cloudflare serves the built pages in `dist/`, the Worker answers `/api/*`.

```sh
bun install
bun run dev       # Vite dev server, /api mounted in it
bun run preview   # build, then run it in the real Workers runtime
bun run deploy    # build and deploy to Cloudflare
```

- Pages: `index.html`, `download/index.html`, `roadmap/index.html` (entries in `src/entries/`).
- Roadmap items: `src/data/roadmap.ts`.
- Data-source footnotes: `src/components/Footnotes.tsx`, kept in line with `docs/data-sources.md`.
- Screenshots in `public/` follow `AGENTS.md`: no unblurred posters, key art or title logos.
