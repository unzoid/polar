# Supabase storage: compact schema and encoding

What Polar stores in its Supabase project, how much each row costs, and the compact layout that
replaces today's tables. Goal 5: everything going into Supabase as small as it can be, within the
free plan's 500 MB database ([supabase.com/pricing](https://supabase.com/pricing)).

Status: **design settled** (owner's answers to I-006, 2026-11-05, in §6); migration and codecs
being built. The settings document (§2.1) waits for I-009.

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
| **E. C plus each title's name (chosen, §3)** | 188 B | 270 B × 2,000 = 528 KiB | **0.9 MiB** |

So for a profile this heavy, today's layout fits about 90 such profiles into ~450 MB of app data;
D fits about 400, E about 510 and C about 560. Most profiles are far lighter; the ratio holds.

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

## 3. Layout (E): what accounts keep

The owner's rule (I-006): an account keeps only the user's own data (which titles, where they
stopped, when) and no image links; a name only where a card must show it the moment a new device
signs in, with what it costs.

- **Images: none.** Each device builds them from the id where the source has a fixed pattern, or
  looks the title up once and keeps what it found (§3.6). A device's own copies stay on that device.
- **Names: one per title, kept.** The Library screen sorts by title (`src/screens/Library.tsx`
  `arrange`, "Sort by: Title") across every saved title at once, and every card's caption is the
  name: without it a new device would fetch one metadata record per saved title before it could
  draw or sort the grid. Cost, measured as in §2: 32 B a library title and 12 B a progress title
  (E against C), **88 KiB for the heavy profile, about 10% of what it keeps**.
- **Episode titles: none.** Only the Continue Watching card shows one (`S1E2 · title`), and that card
  already fetches the show's metadata for its logo (`src/screens/Home.tsx` `ContinueCard`); until it
  arrives the card says `S1E2 · show name`.

### 3.1 `progress`: one row per title

```sql
create table public.progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  meta_id text not null,               -- canonical id: tt…, kitsu:N, or an addon's own id
  kind smallint not null,              -- 0 movie, 1 series
  name text not null,                  -- follows the newest entry (§3.4)
  entries bytea not null check (octet_length(entries) <= 32768),
  updated_at bigint not null,          -- ms, newest entry
  synced_at timestamptz not null default now(),
  primary key (profile_id, meta_id)
);
```

`entries` holds every video of the title (§4.1): its id, season and episode, position and duration in
whole seconds, and the time it was last written. Continue watching and history show the newest video
per title (`crates/library/src/space.rs` `latest_per_title`); other episodes' titles come from the
metadata source when the episode list is opened, as they already do.

### 3.2 `library`

```sql
create table public.library (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  meta_id text not null,
  kind smallint not null,              -- 0 movie, 1 series; 128 + kind = removed
  name text not null,                  -- '' for a removal
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
- `profile_settings.data` stays jsonb until I-009 is answered.

### 3.4 Merging on the server

Last write wins per **video**, not per row, so two devices that played different episodes of a show
both keep theirs. The `before insert or update` trigger on `progress`:

1. decodes `old.entries` and `new.entries`, keeps for each video id the entry with the larger time
   (ties keep the stored one: a re-sent push changes nothing);
2. takes `name` and `kind` from the push only when its newest entry is newer than anything stored;
3. returns `null` (no write, `synced_at` untouched) when nothing changed, so re-sends don't wake
   other devices;
4. clamps every time to `now() + 5 min` (critique H2): a device with its clock far ahead can't make
   its rows win for ever.

Clients push only the entries that changed since their last push; the trigger merges them in. A pull
returns whole rows. `library` keeps `sync_lww` (one record a row) with the same clamp.

### 3.5 Row level security without `user_id`

```sql
create policy "own progress" on public.progress for all to authenticated
  using (profile_id in (select id from public.profiles where user_id = (select auth.uid())))
  with check (profile_id in (select id from public.profiles where user_id = (select auth.uid())));
```

At most 5 profiles an account, so the sub-select is a few index reads. Account deletion still
cascades through `profiles`. Pulls (`profile_id = $1 and synced_at > $2`) walk the primary key's
`profile_id` prefix and filter: a few thousand rows at most, so the separate pull index is dropped.

### 3.6 Images on the device

A pulled title arrives with a name and no pictures. The device fills them in this order and keeps the
result in its own store (`polar.json`), so each title is looked up at most once per device:

| Id | Poster | Background | Source of the pattern |
|---|---|---|---|
| `tt…` (IMDb) | `https://images.metahub.space/poster/medium/{id}/img` | `https://images.metahub.space/background/large/{id}/img` | Cinemeta's own answers name these paths for every title, e.g. [`/meta/series/tt0000105.json`](https://v3-cinemeta.strem.io/meta/series/tt0000105.json) gives `poster/small/tt0000105/img` and `background/medium/tt0000105/img`; the larger sizes are what `crates/index/src/cinemeta.rs` `upgrade_images` already asks for |
| `kitsu:N` | `https://media.kitsu.app/anime/poster_images/{N}/medium.jpg` | looked up | Kitsu's API gives exactly this path for every size, e.g. [`/api/edge/anime/1`](https://kitsu.io/api/edge/anime/1) and `7442`; the Kitsu add-on's [`/meta/series/kitsu:1.json`](https://anime-kitsu.strem.fun/meta/series/kitsu:1.json) gives the same poster. Covers carry a hash or a varying extension (`anime/1/cover_image/large-88da….jpeg`, `cover_images/7442/original.png`), so they can't be built |
| anything else (an add-on's own id) | looked up | looked up | no pattern: the add-on decides |
| TMDB pictures | — | — | never built: [TMDB's image guide](https://developer.themoviedb.org/docs/image-basics) says the `file_path` comes from the movie or show's own record |

"Looked up" means the device asks the title's metadata (`api.meta`, the same call the title page
makes), takes its poster and background, and stores them on the library item or progress row. A
built picture that fails to load (metahub and Kitsu answer 404 for titles without one) falls back to
the lookup once. All checked 2026-11-05.

## 4. Codecs

Shared by the app (TypeScript, `src/lib/account/progressCodec.ts`) and the SQL trigger. Every format
starts with a version byte; an unknown version decodes to nothing and is never written over
(critique H5).

### 4.1 Progress entries

```
[version = 1] then per video, sorted by its key bytes (form + payload; order only makes the bytes repeatable):
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

One migration, `supabase/migrations/<date>_compact_storage.sql`:

1. creates `library` and `progress` with their triggers and policies and the SQL codec functions;
2. copies the old rows in: progress grouped by profile and meta id, positions rounded, the name from
   each title's newest row; library removals as `128 + kind`;
3. drops `library_items` and `watch_progress` (owner's answer: no forwarding period), and the
   `user_id` columns, their indexes and the pull indexes of the kept tables.

App versions older than the migration stop syncing library and progress until they are updated;
their own data stays on their devices and is pushed when they update. The app treats a missing
`progress` table (`PGRST205`/`42P01`) as "server not migrated yet": it keeps library and progress
on the device and pushes them once the table is there.

The same migration carries the sync fixes of `docs/rewrite-plan.md` R2, so the server changes once:
`updated_at` clamped to `now() + 5 min` (critique H2), the playlist limit counting live playlists on
real inserts only (H4), pulls ordered by `(synced_at, key)` (M8), and the legacy `stream` column gone
with `watch_progress` (C3).

## 6. Owner's choices (I-006, answered 2026-11-05)

- What accounts keep: only the user's own data; no image links (§3.6); names only where a card needs
  them at once, with the cost stated (§3: names kept, 88 KiB of 0.9 MiB for the heavy profile;
  episode titles dropped).
- One row per title, episodes packed, merged per episode on the server (§3.1, §3.4).
- Old app versions: cut over at once (§5).

## 7. Checks the owner runs on a real project

To be written with the migration (`docs/unverified.md` will point here): apply the migration on a
copy, run `supabase/checks/compact_storage.sql` (row counts old vs new, a round trip of every row
through the codec, RLS from two users), compare `select pg_size_pretty(pg_database_size(current_database()))`
before and after, and sync two devices across the change.
