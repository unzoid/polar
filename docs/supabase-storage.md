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
  The migration takes keys and `addons` out of the documents already stored. Since #89 keys and
  add-on links travel again, in their own `secrets` field or sealed with a passphrase (§3.7).

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
(`polarity.json`, commands `space_untitled` / `space_fill_display`, `crates/library/src/display.rs`),
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

API keys (TMDB, OMDb, MDBList, Seekr) and add-on manifest URLs sync for every account, with no
setting (#89, §2.1 option D by default, C with a passphrase):

- **By default** they travel as they are, in the settings document's `secrets` field
  (`{ keys: { tmdbKey: … }, addons: [sorted URLs] }`): readable by the server, protected by the
  `own settings` row-level security policy like the rest of the document. The app says so where
  keys and add-ons are entered and in Settings → Account → API keys and addons.
- **With a passphrase** set there, they are sealed (PBKDF2-SHA-256 → AES-GCM, `src/lib/account/secrets.ts`,
  format `s1.salt.nonce.ciphertext`, 600,000 rounds) into one `sealed` field instead; the server never
  sees the passphrase or the plain values. The passphrase is kept on each device (localStorage, per
  profile), beside the keys it protects, which are there in plain text anyway.
- **Who decides** (`sealing` in `settingsDoc.ts`): the document on the server. A device keeps
  sealing while the server's copy is sealed; one that just set a passphrase seals; one that removed
  it (after a confirmation) sends the plain form; a device holding a passphrase that finds the plain
  form with nothing pending forgets its passphrase (removed elsewhere). Changing the passphrase opens
  the server's copy with the previous one until the next write.
- **A device without the passphrase** sends the `sealed` field back unchanged, so it doesn't wipe
  the others' keys; it keeps its own keys and add-ons and Settings → Account asks for the passphrase.
- A profile's first round on a device takes the account's keys but keeps a key the account lacks,
  and no add-on is taken away (`firstDoc`).
- **Per profile on a device** (#80): each profile's keys and add-ons are its own copy on the device,
  put back when it's entered; the guest's are kept aside and put back at sign-out. Unless Settings →
  Account shares add-ons and keys between profiles on the device (on for installs from before #80,
  off for new ones), a profile the device has never synced starts with none of those in the store,
  only the app's own add-ons (`startProfile`), so its first round sends nobody else's to its account.
  While it has none, Settings → Account offers to copy the guest's set or one of the account's other
  profiles' sets kept on the device (`copySetup`); copies sync like any change.
- Versions from before #89 drop the `secrets` field when they write the document (the next newer
  device puts it back from its own copy) and pass `sealed` on as it came. A passphrase typed in such
  a version while the option was off is forgotten on update (nothing was sealed with it).

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

## 8. Account limits (#110)

`supabase/migrations/20261107000000_account_limits.sql` gives every table an account can write a cap
per row and a cap on rows, so one account (or a script signing up many) can only take so much of
the project's 500 MB. The caps leave room for a real household: the heavy test profile of §2 has
2,000 titles.

| Table | Per row | Rows | Worst case per account |
| --- | --- | --- | --- |
| `profiles` | name 1-40 characters, avatar an id (`[a-z0-9-]`, up to 32) | 5 an account | ~1 KiB |
| `library` | `meta_id` up to 200 bytes | 5,000 a profile, 10,000 an account | 10,000 × 764 B = 7.3 MiB |
| `progress` | `meta_id` up to 200 bytes; one entry, up to 512 bytes (32 KB with every episode kept) | 5,000 a profile, 10,000 an account | 10,000 × 1.27 KiB = 12.4 MiB |
| `anime_links` | ids and the canonical id's format | 5,000 a profile | 25,000 × 146 B = 3.5 MiB |
| `playlists` | name 1-60 characters, items 8 KB; a removed one keeps no items | 100 live, 1,000 with removed ones, a profile | 5 × 1.2 MiB = 5.9 MiB |
| `profile_settings` | 16 KB, a JSON object | 1 a profile | 5 × 16 KiB = 0.1 MiB |
| `friend_settings` (#135) | a code and three switches | 1 a profile with Friends on | 5 × ~0.2 KiB |
| `friendships` (#135) | two profile ids and a state | 100 a profile (50 friends, 20 requests waiting) | 500 × ~0.2 KiB = 0.1 MiB |
| **Total** | | | **about 29 MiB** |

Sizes are `pg_total_relation_size` (rows, TOAST and indexes) measured in PGlite with every row at
its largest and ids that don't compress; a real account is far smaller (the heavy profile: 0.66 MiB).
With supabase/optional/per_episode_progress.sql in, a progress row may hold up to 32 KB, so the
worst case of `progress` grows to about 10,000 × 33 KiB = 320 MiB an account: keep that in mind
before turning it on for a project anyone can sign up to.

How the caps work:

- One statement trigger per table counts after each insert (a push of 500 rows counts once). A
  push past a cap is refused as a whole with `library_limit`, `progress_limit`,
  `anime_links_limit` or `playlist_limit`; updates of rows already there always go through.
- At the cap, removals changed more than 90 days ago (library tombstones, removed playlists) are
  deleted first to make room: by then every device has seen them.
- Values: ids without control characters, times not negative (and, as before, not past now + 5 min:
  `added_at` is clamped like `updated_at`), the settings document an object. These checks are
  `not valid`, so the migration never fails on rows already stored: run
  `supabase/checks/account_limits.sql` once afterwards to list rows that don't pass and validate
  the checks.
- Friends (`supabase/migrations/20261108000000_friends.sql`): rows change only through the
  `friend_*` functions, which refuse a request or an answer past the caps with `friend_limit` or
  `friend_requests_limit`; the Friends panel says which.
  `supabase/migrations/20261109120000_friend_tries_and_cap_locks.sql` adds: an account tries up
  to 20 friend codes nobody has in an hour (`friend_request` answers `unknown` for one, then
  refuses with `friend_tries_limit`) and sends up to 30 invites in 10 minutes
  (`friend_invite_limit`); the tries are kept in `friend_tries` for an hour.
- Inserts arriving at the same moment are counted one after the other: the profile limit and the
  row caps take a lock per account first, and friend requests and answers one per pair of profiles.
- In the app (`sync.ts`, `AccountFullToast`): a kind that's full stays on the device and is tried
  again each round, everything else goes on syncing, and a toast says which part is full, once a
  session per kind. Before a push the app leaves out what the server would refuse anyway (an id
  it can't take, an entry past 512 bytes); those titles stay on the device.

### 8.1 CAPTCHA on sign-in

Supabase Auth can require a CAPTCHA on the request that sends the sign-in code. The app shows
Cloudflare Turnstile only when the server asks for it (`captcha_failed`), so nothing changes
until it's turned on. To turn it on:

1. In Cloudflare's dashboard, Turnstile → Add widget: mode Managed; hostnames `tauri.localhost`
   (Windows, Android) and `localhost` (macOS, Linux, iOS, where the app's pages come from
   `tauri://localhost`). Note the site key and the secret key.
2. Build the app with the site key: `VITE_CAPTCHA_SITE_KEY=<site key>` in `.env` (see
   `.env.example`), and ship that version. The site key is public; the secret key never goes in
   the app.
3. Check sign-in with the check showing on each platform (docs/unverified.md, "CAPTCHA").
4. Only then, in Supabase: Project Settings → Authentication → Bot and Abuse Protection (the name
   Supabase's docs give; newer dashboards may call it Attack Protection) → Enable CAPTCHA protection,
   provider Turnstile, paste the secret key, save. From then on, versions built without the site
   key can't sign in new sessions (they say the server asks for a check they can't show; older
   versions show Supabase's error).

### 8.2 Auth rate limits

Authentication → Rate Limits in the Supabase dashboard. Values to start from:

- Emails sent: the built-in mailer allows only a few an hour for the whole project; with your own
  SMTP server set up (Authentication → Emails → SMTP), 30 an hour is plenty for sign-in codes.
- Sign-ups and sign-ins: 10 per 5 minutes per IP address.
- Token verifications (entering the code): 30 per 5 minutes per IP address.
- Keep "Allow new users to sign up" on (signing in creates the account) and the code expiry at an
  hour or less (Authentication → Providers → Email).

### 8.3 Admin scripts

In the dashboard's SQL editor, as the owner:

- `supabase/admin/account_usage.sql` (read-only): the 50 largest accounts with their bytes and rows
  per table, sign-ups per day for 30 days (a burst can be a script), and the size of each table.
- `supabase/admin/delete_account.sql`: deletes one account (put its id in first), as a whole or
  only its profiles and their rows (`keep_sign_in`). It can't be undone.
