# Supabase storage: compact schema and encoding

What Polar stores in its Supabase project, how much each row costs, and the compact layout that
replaces today's tables. Goal 5: everything going into Supabase as small as it can be, within the
free plan's 500 MB database ([supabase.com/pricing](https://supabase.com/pricing)).

Status: **design**. The choices that change what accounts store are asked in the inbox (see §6);
nothing here is migrated until they are answered.

## 1. What is stored today

| Table | Key | Per row | Grows with |
|---|---|---|---|
| `profiles` | id | name, avatar, position | ≤ 5 per account |
| `library_items` | profile, meta id | type, name, poster URL, added/updated ms, deleted | titles saved (and removed: tombstones stay) |
| `watch_progress` | profile, video id | meta id, type, name, background URL, poster URL, season, episode, episode title, position, duration (float8), updated ms, legacy `stream` jsonb | **every episode and movie ever started** |
| `playlists` | id | name, titles packed in `bytea` (~4-5 B a title, `src/lib/playlistCodec.ts`) | playlists (≤ 100 a profile) |
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

So for a profile this heavy, today's layout fits about 90 such profiles into ~450 MB of app data;
D fits about 400 and C about 560. Most profiles are far lighter; the ratio holds.

Where the bytes go in today's progress row: ~24 B tuple header and 4 B line pointer, 32 B of the
two uuids, ~170 B of the two image URLs, ~40 B of name and episode title, ~40 B of numbers, and
three indexes (~110 B). The fixed overhead per row (header + key + index ≈ 70 B) is why packing
episodes into one row per title wins more than shaving columns.

## 3. Proposed layout (D)

### 3.1 `progress`: one row per title

```sql
create table public.progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  meta_id text not null,               -- canonical id: tt…, kitsu:N, or an addon's own id
  kind smallint not null,              -- 0 movie, 1 series
  name text not null,                  -- display fields follow the newest entry (§3.4)
  poster text,                         -- image codec (§4.2)
  background text,
  episode_title text,                  -- of the newest entry only
  entries bytea not null check (octet_length(entries) <= 32768),
  updated_at bigint not null,          -- ms, newest entry
  synced_at timestamptz not null default now(),
  primary key (profile_id, meta_id)
);
```

`entries` holds every video of the title (§4.1): position and duration in whole seconds and the
time each was last written. Continue watching and history only ever show the newest video per
title (`crates/library/src/space.rs` `latest_per_title`), so the title-level name, images and the
newest episode's title are everything those screens draw; other episodes' titles come from the
metadata source when the episode list is opened, as they already do.

### 3.2 `library`

```sql
create table public.library (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  meta_id text not null,
  kind smallint not null,              -- bit 0 as progress.kind; bit 7 (128) = removed
  name text not null,                  -- '' for a removal
  poster text,                         -- image codec
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
- `profile_settings.data` stays jsonb: Postgres compresses values over ~2 KB itself (TOAST), and a
  document is one row a profile.

### 3.4 Merging on the server

Last write wins per **video**, not per row, so two devices that played different episodes of a show
both keep theirs. The `before insert or update` trigger on `progress`:

1. decodes `old.entries` and `new.entries`, keeps for each video the entry with the larger time
   (ties keep the stored one: a re-sent push changes nothing);
2. takes `name`, images and `episode_title` from the push only when its newest entry is newer than
   anything stored;
3. returns `null` (no write, `synced_at` untouched) when nothing changed, so re-sends don't wake
   other devices.

Clients push only the entries that changed since their last push; the trigger merges them in. A pull
returns whole rows. The same rule replaces `sync_lww` on the other tables unchanged.

### 3.5 Row level security without `user_id`

```sql
create policy "own progress" on public.progress for all to authenticated
  using (profile_id in (select id from public.profiles where user_id = (select auth.uid())))
  with check (profile_id in (select id from public.profiles where user_id = (select auth.uid())));
```

At most 5 profiles an account, so the sub-select is a few index reads. Account deletion still
cascades through `profiles`. Pulls (`profile_id = $1 and synced_at > $2`) walk the primary key's
`profile_id` prefix and filter: a few thousand rows at most, so the separate pull index is dropped.

## 4. Codecs

Shared by the app (TypeScript, `src/lib/account/codec.ts`), the Rust tests and the SQL trigger. Every
format starts with a version byte; an unknown version decodes to nothing and is never written over.

### 4.1 Progress entries

```
[version = 1] then per video, sorted by key:
  [tag] [key payload] [position varint] [duration varint] [age varint]
  tag 0: the video is the title itself (movie: video id = meta id), no payload
  tag 1: `${meta}:${season}:${episode}`, payload season varint, episode varint
  tag 2: `${meta}:${episode}` (Kitsu-style), payload episode varint
  tag 3: any other video id (e.g. kept under its Kitsu id after a link), payload varint length + UTF-8
  position, duration: whole seconds
  age: row updated_at − entry time, ms (0 for the newest)
```

A typical episode is 1 + 2 + 2 + 2 + 3-4 ≈ 10-11 bytes. Varints are LEB128 like playlistCodec.

### 4.2 Images

Image URLs are mostly a fixed host and path around an id, so the first character says which:

| Stored | Means |
|---|---|
| `\x01` + rest | `https://image.tmdb.org/t/p/` + rest (`w342/abc.jpg`) |
| `\x02` | `https://images.metahub.space/poster/medium/${meta}/img` (nothing else stored) |
| `\x03` | `https://images.metahub.space/background/large/${meta}/img` |
| `\x04` + rest | `https://images.metahub.space/` + rest |
| `\x05` + rest | `https://media.kitsu.app/` + rest |
| anything else | the URL as it is |

New prefixes take new codes; codes are never reused. A Cinemeta title then stores 1 byte per image,
a TMDB one ~25 instead of ~65.

## 5. Migration from today's tables

1. `supabase/migrations/<date>_compact_storage.sql`: creates `library` and `progress` with their
   triggers and policies, the SQL codec functions, and copies the old rows in (progress grouped
   by profile and meta id, positions rounded, display fields from each title's newest row). The
   `user_id` columns, their indexes and the pull indexes of the kept tables go.
2. The old tables stay, read-only for the new app. A forwarding trigger copies writes from app
   versions that don't know the new tables, so a device not yet updated keeps uploading (it no longer
   sees others' changes until it updates).
3. `supabase/cleanup/<date>_drop_old_tables.sql`, **not** a migration: drops `library_items` and
   `watch_progress`. The owner runs it once every device is updated.

The app reads the new tables and, when they are missing (`PGRST205`/`42P01`, as `anime_links` does
today), falls back to the old ones, so the app and the migration can be released in either order.

## 6. Owner's choices (asked in the inbox)

- Which display fields an account keeps (D above; C = none; or today's, per episode).
- One row per title with packed episodes (D/C) or one row per episode (A/B).
- Old app versions: keep a forwarding period (§5.2) or cut over at once.

## 7. Checks the owner runs on a real project

To be written with the migration (`docs/unverified.md` will point here): apply the migration on a
copy, run `supabase/checks/compact_storage.sql` (row counts old vs new, a round trip of every row
through the codec, RLS from two users), compare `select pg_size_pretty(pg_database_size(current_database()))`
before and after, and sync two devices across the change.
