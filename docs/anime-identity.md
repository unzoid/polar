# One show, one item: unifying anime identities

Status: steps 1 and 2 done (`src/lib/library/identity.ts`, `crates/library`); steps 3-6 to do.
Code references are to commit bcd0a85.

## The problem

Polarity knows a show by a string id. For anything a metadata addon knows that is an IMDb id
(`tt0000103`); for anime with no usable IMDb page it is a Kitsu id (`kitsu:7442`). Episodes
are `tt…:S:E` or `kitsu:N:E`. The anime pages start from an AniList entry and pick the id each
time the page is opened (`usePlayback` in `src/screens/AnimeDetail.tsx`, `TvAnimeDetail` in
`src/tv/TvAnime.tsx`), through ani.zip and, since bcd0a85, `imdbForAnime`
(`src/lib/anime/search.ts`), which can override ani.zip's link with a Cinemeta title search.

Nothing remembers that choice. So the same show splits into several items when:

1. ani.zip later gains an IMDb id for an entry the user first watched as `kitsu:N`. Library,
   history and continue watching group by `meta_id` (`continue_watching`, `watch_history` in
   `src-tauri/src/commands.rs`), so the old `kitsu:N` rows and the new `tt…` rows are two titles.
2. A franchise has some cours mapped to an IMDb show and some only to Kitsu.
3. `imdbForAnime`'s title search answers differently on another day or device (Cinemeta
   results change), giving a different id for the same entry.
4. Search shows AniList cards and Cinemeta cards side by side; `withoutAnime`
   (`search.ts`) hides Cinemeta results by title and year rather than knowing they are the same.
5. Anime context (Kitsu alt ids for addons, MAL id for AniSkip, filler flags, stills) is kept in
   in-memory maps (`altIds.ts`, `aniskip.ts`, `filler.ts`, `stills.ts`) filled only by the desktop
   anime page, so resuming from Continue Watching after a restart loses it.

A related, non-anime split: with a TMDB key, episode ids use TMDB's season numbering
(`crates/index/src/tmdb.rs`), without one Cinemeta's. That is handled separately (step 6).

Constraint: no central database of Polarity's own (the Supabase project has 500 MB in all). The
mapping has to come from public mapping sources (ani.zip, with Fribb/anime-lists as fallback,
see `docs/data-sources.md`) and from each user's own choices, stored with their own data.

## The model

**Canonical id.** Every title has exactly one canonical id, and every store keys titles by it:

- an IMDb id `tt…` when Polarity plays the show from an IMDb page;
- otherwise `kitsu:N`.

Other ids are **aliases**: `kitsu:N` (once an IMDb page is known), `anilist:N`, `mal:N`. An alias
points at a canonical id. Two rules keep this from merging different shows:

1. **An IMDb id is never an alias.** Two `tt` ids are never joined, whatever any source says.
   Paleblade and Paleblade: Hundred-Night Ash War stay two titles, even though ani.zip links HNAW's
   AniList entry to Paleblade's IMDb id and Polarity plays it from HNAW's.
2. **An alias has one target; the latest decision wins.** `anilist:41467 → tt0000111` replaces an
   earlier `anilist:41467 → tt0000103`. Aliases form chains of at most two steps
   (`anilist → kitsu → tt`); resolving follows them, with a step limit so a bad record cannot
   loop.

**Episodes are not re-keyed.** A progress row keeps the video id it was played under
(`kitsu:N:E` stays playable: many stream addons accept Kitsu ids). Only its
`meta_id` is the canonical title, so grouping, history, continue watching and "watched" flags
see one title. The anime page already lines every AniList episode up with both ids (the
`alignByAirDate`/`matchVideo` work in `AnimeDetail.tsx`); it looks progress up under both.

**Where an alias comes from**, in order of trust:

1. The user's own data: the id Polarity actually played or added from (written when it happens).
2. ani.zip's `mappings` (live, cached on disk for 7 days).
3. Fribb/anime-lists `anime-list-mini.json`, fetched from GitHub at runtime and cached for a
   week, only when ani.zip fails (approved in I-001; `crates/anime/src/anime_lists.rs`, used by
   `fetchAniZip` in `src/lib/anime/anizip.ts`).

**Anime links.** For each canonical anime title Polarity stores one small record, the *link*:
`{ anilist, mal?, kitsu? }`, plus `imdb` when canonical is a `tt`. It is the persisted form of
what the in-memory maps hold today, and the alias set is derived from it (`anilist:N`, `mal:N`,
`kitsu:N` all point at the canonical id). One record per anime title the user has touched: a
handful of integers.

## Where it lives

- **Rust, `crates/library`** (pure, tested without Tauri): `Space.links: BTreeMap<AniList id,
  AnimeLink>`, stored and synced with the library. Aliases are computed from the links when
  needed (not stored twice). `Space::library_toggle`, `progress_save` canonicalise the incoming
  id/`meta_id` through the aliases before writing; `progress_for`, `continue_watching` and
  `watch_history` group by canonical id. `Space::link_anime(link)` records a link (an older one
  for the same AniList entry is ignored) and **re-keys**: library items and progress `meta_id`s
  under any of the link's ids move to the canonical id (library: one item, earliest `added_at`;
  the old key is tombstoned so the server row is deleted; a title removed under its canonical id
  after the item last changed stays removed). The moved item and the tombstone are stamped with
  the newest link's time (or the item's own, if later), never the local clock, so a device that
  re-keys after pulling a link reaches exactly the state the linking device pushed.
- **Tauri commands** (`src-tauri/src/commands.rs`): `link_anime(link)` (sets `updatedAt`) and
  `anime_links()`; the library/progress commands call `crates/library`.
- **Only links that say something** (#102): `link_anime` stores nothing when the link names the
  IMDb title the anime id lists already give the entry and nothing is kept under the show's ids
  (`Space::needs_link`): every device and every card works that answer out from the lists the same
  way (`linkedImdb`: a stored link first, else the lists'). Stored: links that differ from the
  lists (title search, Kitsu-only shows, corrections), ones the profile already has, and any for a
  show in the library or with progress, so a later change in the lists can't move what's there.
  The desktop anime page asks again once the show is added to the library or gets progress; the
  TV path links when a card is opened, before anything is kept, so such a show's link is stored
  the next time it's opened on desktop. Links stored before #102 stay.
- **Front end**: `src/lib/library/identity.ts` holds the id grammar (parse/format `tt`, `kitsu:`,
  `anilist:`, `mal:`, episode ids) and `canonicalId()`. The anime pages (desktop `AnimeDetail`, TV
  `TvAnime`) call `linkAnime` (`src/lib/anime/links.ts`) once the IMDb lookup has answered; the
  command ignores a link it already has, so no time changes and sync has nothing to send. What a
  page lines up per episode (absolute number, MAL/Kitsu ids, filler) is kept in localStorage by
  `src/lib/anime/playContext.ts` (per canonical title, 300 most recent), which replaced the
  in-memory `altIds`/`aniskip`/`filler` maps, so AniSkip, Kitsu alt ids and skip-filler work from
  Continue Watching and after a restart. AniSkip for a `kitsu:N:E` video with no context takes
  the MAL id from the stored link. The anime page reads progress played under `kitsu:N:E` as the
  matching IMDb episode. Not covered: TV mode lines up no episodes itself, so an IMDb episode
  first played from TV, never from a desktop anime page, still falls back to ani.zip's mapping.
- **Search** (`withoutAnime`, `src/lib/anime/merge.ts`): an AniList card with a stored link
  resolves to its canonical id, and movie/series results with that canonical id are dropped (the
  anime card opens the anime page); for a linked card only the id decides. Cards without a link
  still use the title/year guess: search asks no ani.zip per card, since ani.zip's unchecked link
  can name the wrong show (HNAW → Paleblade) and would cost a request per card. Results that are one
  show under two ids (`kitsu:N` from an addon and its `tt…`) show once.
- **Sync**: links are one more synced kind (table `anime_links`, step 5):
  `(profile, anilist id) → canonical id, mal, kitsu, updated_at`. Roughly 20-30 bytes per anime the
  user has touched.

## Steps

1. `src/lib/library/identity.ts`: id grammar, alias resolution, canonical choice; unit tests.
2. Rust: `AnimeLink`, `Space.links`, alias resolution, canonicalising writes, re-keying on
   `link_anime`; unit tests for re-keying (library merge, progress `meta_id`, tombstones, chains,
   the never-join-two-`tt` rule).
3. Anime pages and TV: call `linkAnime` with the chosen id; replace `altIds`/`aniskip`/`filler`
   maps with lookups through the link (persisted), so playback from anywhere has them.
4. Search: merge AniList and Cinemeta/TMDB results by canonical id.
5. Sync: push/pull links; apply re-keying on pull. Done: table `anime_links`
   (`supabase/migrations/20261104000000_anime_links.sql`, owner's answer I-005: same row-level
   security and last-write-wins trigger as the library), pushed and pulled with library and
   progress under one cursor (`src/lib/account/sync.ts`, `supabase.ts`). A server without the
   table still syncs the rest; the profile's links are then sent in full once it has it. The
   storage redesign (T-010) keeps this table as it is: it is already one small row per anime.
6. Episode numbering: store progress for `tt` shows under IMDb (Cinemeta) numbering always; when
   the metadata source is TMDB, map TMDB `S:E` to IMDb `S:E` by air date before saving (the same
   matching the anime pages use). Stream addons expect IMDb numbering too.
   Done: `polar_addon::numbering::renumber` (air date within a day, then the numbers;
   IMDb-only episodes added, TMDB-only ones kept unless their id is IMDb's for another
   episode), called from `Indexer::meta` for TMDB series. Progress stored earlier under
   TMDB numbers is not moved (docs/unverified.md).

## Seasons as separate shows (#22)

Settings → Anime → Seasons as separate shows changes what is shown, not what is stored. Lists
(search, shelves, browse, TV rails) show every AniList entry as its own card instead of one per
franchise (`cardsShown` in `src/lib/anime/franchise.ts`), and an entry's page has only its own
episodes, with its prequel and sequel among the related titles. The library, progress, history and
links keep one item per canonical id, so switching the setting either way moves nothing and sync
is unchanged.

A stored title's card (Continue Watching, Library, history, in both modes) shows the entry the
episode being watched belongs to: its name and poster, the episode's number within it, and its page
when opened. Which entry an episode belongs to is what the anime page (or a TV card being opened)
worked out when it lined that entry's episodes up with the title's videos; it is kept on the device
only (`src/lib/anime/entries.ts`, localStorage, newest 300 titles). An entry never lined up on this
device leaves its title's card as stored. In TV mode an entry opens its title's page with only that
entry's episodes, numbered as in the entry.

## What stays unsolved

- Two `tt` shows that really are one show on IMDb's side (duplicates on IMDb) stay two.
- If the user plays an entry as `tt-A` on one device and, before syncing, as `tt-B` on another,
  the latest link wins; rows already written under `tt-A` stay there (never-join rule).
- Without ani.zip and Fribb (offline), new anime cannot be linked; already linked ones work,
  since links are stored.
