# Supabase storage: compact schema and encoding

What Polarity stores in its Supabase project, how much each row costs, and the compact layout that
replaces today's tables. Goal 5: everything going into Supabase as small as it can be, within the
free plan's 500 MB database ([supabase.com/pricing](https://supabase.com/pricing)).

Status: **migration written and checked in PGlite** (`supabase/migrations/20261105000000_compact_storage.sql`);
the app's side is being built. Owner's decisions (I-006, I-009 and the goal's addendum of 2026-11-05)
in §6.

## 1. What is stored today

| Table | Key | Per row | Grows with |
|---|---|---|---|
| `profiles` | id | name, avatar, position | ≤ 5 per account |
| `library_items` | profile, meta id | type, name, poster URL, added/updated ms, deleted | titles saved (and removed: tombstones stay) |
| `watch_progress` | profile, video id | meta id, type, name, background URL, poster URL, season, episode, episode title, position, duration (float8), updated ms, legacy `stream` jsonb | **every episode and movie ever started** |
| `playlists` | id | name, titles packed in `bytea` (~4-5 B a title, `src/lib/library/playlistCodec.ts`) | playlists (≤ 100 a profile) |
| `profile_settings` | profile | one jsonb document ≤ 16 KB | 1 a profile |
| `anime_links` | profile, AniList id | canonical id, MAL, Kitsu, updated ms | anime opened |

Every per-profile table also carries `user_id` (16 B) with its own index, and a second index on
`(profile_id, synced_at)` for pulls. Progress is by far the largest table and the only one that
grows without a bound: one row per episode, each repeating the show's name and two image URLs.

## 2. Measured cost per row

`work/tmp/pgcheck/size.ts` (not in the repo; PGlite, Postgres 17) fills the tables with an invented
heavy profile: 2,000 library titles, 400 shows × 25 episodes and 1,600 movies of progress (11,600
rows), then measures `pg_total_relation_size` (heap + TOAST + every index) after `VACUUM`.

| Layout | Library | Progress | Profile total |
|---|---|---|---|
| Today | 319 B × 2,000 = 624 KiB | 405 B × 11,600 = 4,584 KiB | **5.1 MiB** |
| A. Same contents, tight types (no `user_id`, no pull index, smallint kind, int seconds) | 254 B | 335 B × 11,600 = 3,800 KiB | 4.2 MiB |
| B. A without any names or images, one row per episode | 156 B | 151 B × 11,600 = 1,712 KiB | 2.0 MiB |
| **D. Names and images once per title, image URLs prefix-coded, episodes packed per title** | 225 B | 365 B × 2,000 titles = 712 KiB | **1.1 MiB** |
| C. D without names or images | 156 B | 258 B × 2,000 = 504 KiB | 0.8 MiB |
| E. C plus each title's name | 188 B | 270 B × 2,000 = 528 KiB | 0.9 MiB |
| **F. No show information; progress one entry per title (built, §3)** | 156 B | 193 B × 2,000 = 376 KiB | **0.66 MiB** |
| G. F with every episode packed per title (built, off: §3.4) | 156 B | 254 B × 2,000 = 496 KiB | 0.78 MiB |

So for a profile this heavy, today's layout fits about 90 such profiles into ~450 MB of app data;
D fits about 400, F about 680 and G about 580. Most profiles are far lighter; the ratio holds.

Where the bytes go in today's progress row: ~24 B tuple header and 4 B line pointer, 32 B of the
two uuids, ~170 B of the two image URLs, ~40 B of name and episode title, ~40 B of numbers, and
three indexes (~110 B). The fixed overhead per row (header + key + index ≈ 70 B) is why packing
episodes into one row per title wins more than shaving columns.

### 2.1 Settings documents: keys and add-on links (I-007)

`work/tmp/pgcheck/settings_size.ts` (PGlite, seeded random) builds one settings document per profile
the way `src/lib/account/settingsSync.ts` does (every setting, synced prefs, changed shortcuts, add-on
manifest URLs) for 5,000 invented users and stores them in today's `profile_settings` table (uuid key,
`user_id` and its index, jsonb, two stamps), measured with `pg_total_relation_size` after `VACUUM`.

The invented spread (not measured from real users):

- Profiles per user: 1 (60%), 2 (25%), 3 (10%), 4-5 (5%): 8,017 profiles.
- Keys per profile: TMDB 35% (70% a 32-character v3 key, 30% a ~250-character v4 token), OMDb 15%,
  MDBList 10%, Seekr 5%.
- Add-ons per profile: the bundled subtitles add-on, plus none (40%), 1-2 (30%), 3-5 (20%) or 6-11
  (10%) more. Of those: 40% a plain public URL (~45 characters), 30% configured without anything
  personal (options as base64 in the path, 170-450 characters), 30% carrying a personal token
  (150-400 characters).
- Option C: keys and all add-on URLs sealed in one AES-GCM blob (16 B salt, 12 B nonce, 16 B tag),
  base64. Random bytes don't compress, so Postgres's own compression gains nothing on it.

| Option | Per profile | 5,000 users | Share of 500 MB |
|---|---|---|---|
| D. Sync keys and add-on links as today | 2,571 B | 19.7 MiB | 4.1% |
| C. Sync them encrypted with a passphrase | 2,972 B | 22.7 MiB | 4.8% |
| B. Keys on the device; token-free add-on links synced | 2,429 B | 18.6 MiB | 3.9% |
| A. Keys and add-on links on the device only | 2,134 B | 16.3 MiB | 3.4% |
| A, and only the settings changed from their defaults | 703 B | 5.4 MiB | 1.1% |

What this shows: keys and add-on links are a small part of the document (D to A saves 437 B a
profile, 3.4 MiB per 5,000 users). Most of each document is the ~50 settings written out in full
even when nobody changed them (about 1.4 KB). Sending only the settings a profile changed (here
10% of them) shrinks the table by two thirds whichever of A-D is chosen. The catch: a setting left
at its default follows the app's default if a later version changes it, which is what most people
expect anyway.

The choice between A-D is therefore about safety more than size: a key or a personal add-on link
in the account is readable by anyone who gets into the account or the database (a leaked password,
a Supabase dashboard login, a backup), and the keys are the user's own accounts at TMDB, OMDb,
MDBList and Seekr. A and B keep them off the server; C keeps them on it but unreadable without the
passphrase; D keeps them readable as today.

## 3. Layout (F): only the user's own data

The owner's rule (goal, 2026-11-05): no show information in Polarity's database. Names, posters,
backgrounds, episode titles and every other fact about a show or film come from the metadata
sources, never from Supabase. An account holds which titles, where the user stopped, when, and
their settings and profiles.

- **Library:** id, movie or series, when added, when last changed, removed or not.
- **Progress:** one row per title holding **one entry**, the newest video the profile is on (what
  Continue Watching needs): its id, season and episode numbers, position, duration, time. Every
  episode's position stays on the device that played it.
- **Every picture and name is looked up on the device** (§3.6) and kept there.
- Per-episode history (every video packed per title, merged per video on the server) is built and
  tested but off (§3.4).

### 3.1 `progress`: one row per title

```sql
create table public.progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  meta_id text not null,               -- canonical id: tt…, kitsu:N, or an addon's own id
  kind smallint not null,              -- 0 movie, 1 series
  entries bytea not null check (octet_length(entries) <= 32768),
  updated_at bigint not null,          -- ms, newest entry
  synced_at timestamptz not null default now(),
  primary key (profile_id, meta_id)
);
```

`entries` (§4.1) holds the newest video of the title: its id, season and episode, position and
duration in whole seconds, and the time it was written. Continue watching and history show the
newest video per title (`crates/library/src/space.rs` `latest_per_title`), so that is all a new
device needs. With per-episode history on (§3.4) it holds every video of the title instead.

### 3.2 `library`

```sql
create table public.library (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  meta_id text not null,
  kind smallint not null,              -- 0 movie, 1 series; 128 + kind = removed
  added_at int not null,               -- seconds since 1970 (display order only)
  updated_at bigint not null,          -- ms, what last-write-wins compares
  synced_at timestamptz not null default now(),
  primary key (profile_id, meta_id)
);
```

Removals stay as rows (tombstones, ~60 B each) as they do today: a device that was offline must
still learn of them.

### 3.3 The other tables

- `anime_links`, `playlists`, `profile_settings`: lose `user_id` and its index, and the pull index
  (§3.5). Contents unchanged: links are already ~30 B of data, playlists already packed.
- `profile_settings.data` stays jsonb, but holds only what a profile changed from the defaults, and
  never API keys or add-on links (I-009: they stay on each device; a new device asks for them again).
  The migration takes keys and `addons` out of the documents already stored. Encrypted sync of keys
  and add-on links with a passphrase is built behind a setting, off (§3.7).

### 3.4 Merging on the server

The `progress_sync` trigger (`before insert or update`) checks every push: entries that don't decode
as version 1 are refused (`bad_entries`), each time is clamped to `now() + 5 min` (critique H2), and
the entries are re-encoded, so what is stored always decodes.

**One entry per title (on):** `progress_newest` keeps the push's newest entry when it is newer than
the stored one, else writes nothing; `kind` follows it.

**Per-episode history (built, off until the server turns it on):** `supabase/optional/per_episode_progress.sql` swaps in
`progress_merge`, last write wins per **video**, so two devices that played different episodes of a
show both keep theirs:

1. decodes the stored and pushed entries, keeps for each video id the entry with the larger time
   (ties keep the stored one: a re-sent push changes nothing);
2. takes `kind` from the push only when its newest entry is newer than anything stored;
3. returns `null` (no write, `synced_at` untouched) when nothing changed, so re-sends don't wake
   other devices.

The script also creates `polar_every_episode()` (returns `true`, callable by signed-in users). Before
a push the app calls it (`serverKeepsEveryEpisode` in `src/lib/account/supabase.ts`, at most once
every ten minutes): while it answers, the app pushes every changed episode; while the function is
missing, only each title's newest. There is no setting: running the script turns it on for every
user within ten minutes. `per_episode_progress_off.sql` drops the function and goes back, cutting
every row down to its newest entry. Episodes changed before the switch stay on their device until
they change again. Measured cost:
the heavy profile's progress grows from 376 KiB to 496 KiB (§2).

`library` keeps `sync_lww` (one record a row) with the same clamp.

### 3.5 Row level security without `user_id`

```sql
create policy "own progress" on public.progress for all to authenticated
  using (profile_id in (select id from public.profiles where user_id = (select auth.uid())))
  with check (profile_id in (select id from public.profiles where user_id = (select auth.uid())));
```

At most 5 profiles an account, so the sub-select is a few index reads. Account deletion still
cascades through `profiles`. Pulls (`profile_id = $1 and synced_at > $2`) walk the primary key's
`profile_id` prefix and filter: a few thousand rows at most, so the separate pull index is dropped.

### 3.6 Names and pictures on the device

A pulled title arrives with an id, a kind and times only. After each sync round the device looks up
every title it has no name for (`src/lib/account/titleDisplay.ts`: newest first, four at a time,
through `api.meta`, the call the title page makes) and keeps the name and pictures in its own store
(`polar.json`, commands `space_untitled` / `space_fill_display`, `crates/library/src/display.rs`),
so each title is looked up once per device. Filling moves no times, so nothing is pushed back.
Pictures the lookup didn't give are built from the id where the source has a fixed pattern:

| Id | Name | Poster | Background | Source of the pattern |
|---|---|---|---|---|
| `tt…` (IMDb) | looked up | `https://images.metahub.space/poster/medium/{id}/img` | `https://images.metahub.space/background/large/{id}/img` | Cinemeta's own answers name these paths for every title, e.g. [`/meta/series/tt0000105.json`](https://v3-cinemeta.strem.io/meta/series/tt0000105.json) gives `poster/small/tt0000105/img` and `background/medium/tt0000105/img`; the larger sizes are what `crates/index/src/cinemeta.rs` `upgrade_images` already asks for |
| `kitsu:N` | looked up | `https://media.kitsu.app/anime/poster_images/{N}/medium.jpg` | looked up | Kitsu's API gives exactly this path for every size, e.g. [`/api/edge/anime/1`](https://kitsu.io/api/edge/anime/1) and `7442`; the Kitsu add-on's [`/meta/series/kitsu:1.json`](https://anime-kitsu.strem.fun/meta/series/kitsu:1.json) gives the same poster. Covers carry a hash or a varying extension (`anime/1/cover_image/large-88da….jpeg`, `cover_images/7442/original.png`), so they can't be built |
| anything else (an add-on's own id) | looked up | looked up | looked up | no pattern: the add-on decides |
| TMDB pictures | — | — | — | never built: [TMDB's image guide](https://developer.themoviedb.org/docs/image-basics) says the `file_path` comes from the movie or show's own record |

A title whose lookup fails is not asked for again until the app restarts. All patterns checked
2026-11-05.

The cost of keeping names off the server: a new device looks up every saved and started title once
(newest first) before the Library can sort it by title; until its name arrives a card is blank.

### 3.7 Keys and add-on links

API keys (TMDB, OMDb, MDBList, Seekr) and add-on manifest URLs stay on each device (I-009 A). Built
and off: the `syncSecrets` setting seals them with a passphrase typed on each device (PBKDF2-SHA-256
→ AES-GCM, §2.1 option C) into the settings document as one `sealed` field; the server never sees
the passphrase or the plain values. Built: `src/lib/account/secrets.ts` (format `s1.salt.nonce.ciphertext`,
600,000 rounds) and `settingsDoc.ts` (tested); Settings → Account → "Sync API keys and addons". The
passphrase is kept on the device (localStorage, per profile), beside the keys it protects, which are
there in plain text anyway. A `sealed` field a device can't open is sent back unchanged, so a device
without the passphrase doesn't wipe the others' keys.

## 4. Codecs

Shared by the app (TypeScript, `src/lib/account/progressCodec.ts`) and the SQL functions
`polar_entries` (decode) and `polar_entry` (encode one video) in the migration. Every format
starts with a version byte; an unknown version decodes to nothing and is never written over
(critique H5).

### 4.1 Progress entries

```
[version = 1] then per video (one, unless per-episode history is on), sorted by its key bytes (form + payload; order only makes the bytes repeatable):
  [flags] [key payload] [season varint]? [episode varint]? [position varint] [duration varint] [age varint]
  flags bits 0-1, the video id's form:
    0  the title's own id (a movie), no payload
    1  `${meta}:${season}:${episode}`, payload season varint, episode varint
    2  `${meta}:${episode}`, payload episode varint
    3  any other id, payload varint length + UTF-8
  flags bit 2: the entry has a season; bit 3: it has an episode. Forms 1 and 2 supply the numbers
    they carry; numbers the form doesn't carry follow as varints. An entry whose numbers differ from
    its id's is written in form 3.
  position, duration: whole seconds (rounded)
  age: row updated_at − entry time, ms (0 for the newest)
```

A typical episode is 1 + 2 + 2 + 2 + 3-4 ≈ 10-11 bytes. Varints are LEB128 like `playlistCodec.ts`.

## 5. Migration from today's tables (cut over at once)

`supabase/migrations/20261105000000_compact_storage.sql`, checked in PGlite (Postgres 17) by
`tests/sql/compactStorage.test.ts`, which `bun run test` and CI run:

1. creates `library` and `progress` with their triggers and policies and the SQL codec functions;
2. copies the old rows in: library without names or posters (removals as `128 + kind`), progress as
   each title's newest video, position rounded (NaN or negative → 0);
3. drops `library_items` and `watch_progress` (no forwarding period), the `user_id` columns of the
   kept tables with their policies, and `anime_links`' pull index;
4. removes keys and `addons` from the stored settings documents;
5. clamps client times (H2) and makes the playlist limit count live playlists on real inserts only
   (H4).

**What the copy loses on the server:** every episode but the newest per title, and all names and
pictures. Each device keeps its own full history and pictures locally. App versions older than the
migration stop syncing library and progress until they are updated; their data stays on their
devices and is pushed when they update. The app treats a missing `progress` table
(`PGRST205`/`42P01`) as "server not migrated yet": it keeps library and progress on the device and
pushes them once the table is there.

Left for the app: pulls ordered by `(synced_at, key)` (M8).

## 6. Owner's decisions

- I-006 (2026-11-05): one row per title (§3.1), merged on the server (§3.4); cut over at once (§5).
- Goal addendum (2026-11-05): no show information in the database at all (§3, §3.6); progress one
  entry per title, per-episode history built behind a setting with its script ready (§3.4).
- I-009 (2026-11-05): keys and add-on links on the device only, removed from stored documents by
  the migration; encrypted sync built behind a setting, off (§3.7); settings documents carry only
  what a profile changed from the defaults.

## 7. Checks the owner runs on a real project

`supabase/checks/compact_storage.sql` (read-only): part 1 before the migration (row counts, database
size), part 2 after (same counts, every progress row decodes to one entry, no keys or add-on links
left in settings, old tables and `user_id` gone, RLS on, database size). Part 3 and the two-device
checks are in `docs/unverified.md` ("Compact account storage").
