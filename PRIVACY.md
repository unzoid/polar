# Privacy Policy

Last updated: 07/11/2026

Polarity is a media player. This page says what it stores about you, where, and who else your device talks to while
you use it. It's written from what the app does today; where something isn't settled yet, it says so.

## Who is responsible

The Polarity project, run by the maintainers of the
[github.com/unzoid/polarity](https://github.com/unzoid/polarity) repository. For anything about your data (a question,
a copy of it, a correction, deletion) write to support@getpolar.app, or open an issue on that repository
for anything that isn't private.

## In short

- You can use Polarity without an account. Then nothing about you leaves your device except what the services in
  [Services your device talks to](#services-your-device-talks-to) need to answer it.
- With an account, your profiles, library, watch progress, playlists and settings are kept on Polarity's account
  server so they sync between your devices.
- Polarity has no ads, tracking or analytics, and doesn't sell your data.

## What the account server stores

The account server runs on [Supabase](https://supabase.com). Hosted in: eu-west-3. When you sign
in, it keeps:

- **Your email address**, which you sign in with (a login code is emailed to you; there's no password), and the
  times you signed in. Supabase's sign-in service also keeps its own logs of requests, which include your IP address.
  How long those are kept: 1 day
- **Profiles:** each profile's name and the avatar picked for it (one of the app's built-in pictures, never a photo).
- **Library:** which titles are in each profile's library, by id (for example an IMDb or Kitsu id), and when they
  were added. Not their names or pictures.
- **Watch progress and history:** for each title, the episode you were on, how far in, its length, and when.
- **Anime links:** which anime entries count as the same show for each profile (AniList, MyAnimeList and Kitsu
  ids).
- **Playlists:** their names and the titles in them.
- **Settings**, including **API keys and add-on links** you entered. These are readable by the server, so by its
  operators, **unless you set a passphrase in Settings → Account**: then they're encrypted on your device before
  they're sent, and only a device with the passphrase can read them.

Polarity's account server doesn't keep what you search for, which sources you picked, stream links, subtitles, your
downloads or your local files.

**How long:** until you delete it. Removing a title or playlist leaves a small marker so your other devices remove it
too; markers older than 90 days are cleared when a profile reaches its size limit. Whether and for how long the
server's backups keep deleted data: **[to fill in from the Supabase plan]**.

## What stays on your device

These never go to the account server:

- **The log** (`polar.log`, at most 1 MB plus one older copy). It records what went wrong, never your keys, add-on
  or stream links, or what you watch. It leaves your device only if you copy it yourself, for example with "Copy
  details" on a playback error, which is redacted the same way.
- **Recent searches**, while "Remember recent searches" is on (Settings → Browsing).
- **Caches** of catalog and anime data (most kept up to a day, the anime id list a week). Settings → About → Cache
  shows and clears them.
- **Downloads**, **local files** you open (and their Recent files list and where you stopped in them), and the
  **Stremio export file** if you import one: it's read on your device and only the library and add-ons you choose are
  kept.
- **API keys and add-on links** on your device are kept in the system's keychain where there is one.
- **Discord Rich Presence**, if you turn it on in Settings → Playback (it's off by default), talks only to the
  Discord app on the same computer. What it shows (Polarity, or the title you're watching, as you choose) then
  appears on your Discord profile, so Discord and the people who can see your profile see it, under
  [Discord's privacy policy](https://discord.com/privacy).

## Services your device talks to

Polarity looks titles up by contacting these services **directly from your device**. Each sees your IP address and
what it's asked for (usually a title id or a search), and uses your key where you entered one. Their own privacy
terms apply:

- **Catalogs and details:** TMDB, Cinemeta, IMDb, AniList, ani.zip, the Fribb anime list (on GitHub), Jikan
  (MyAnimeList), Anime Filler List, and the image hosts they point to.
- **Ratings, skip times and previews:** MDBList, OMDb, AniSkip, IntroDB, Seekr (the ones with keys only when you've
  entered a key).
- **Subtitles:** the OpenSubtitles add-on Polarity starts with, and any subtitle add-ons you install.
- **Your own add-ons:** the add-ons you install are run by other people. They see your IP address and which titles
  you ask them about. Polarity doesn't choose, check or vouch for them.
- **Torrent playback:** while a torrent source plays (and afterwards, only if you turned on Keep sharing after playback), the
  other people in that torrent see your IP address and which pieces of the file you download and upload.
- **Linked list accounts:** only for a profile that links an AniList or MyAnimeList account in Settings → Services.
  The anime episodes and films it watches, and the changes you make on an anime's page, go to that service under
  your account, and its list is read to show and import it. The sign-in and what is read from the list stay on your
  device (the system's keychain where there is one) and never go to Polarity's account server. Unlinking removes them.
- **Trakt:** only for a profile that links a Trakt account in Settings → Services. While it plays a film or an
  episode that has an IMDb id, Trakt is told what is playing and how far along it is (Trakt shows this as "watching
  now" on your profile, as public as your Trakt profile is); what you finish or mark watched goes to your Trakt
  history, and ratings you give on a title page go to Trakt. With the watchlist switch on, titles you add to or remove
  from your library are added to or removed from your Trakt watchlist. Your Trakt history, watchlist and ratings are
  read to import them and to bring in what you watch elsewhere. Anime played from Kitsu ids aren't sent. The sign-in
  stays on your device (the system's keychain where there is one) and never goes to Polarity's account server;
  unlinking revokes it and removes it.
- **Simkl:** only for a profile that links a Simkl account in Settings → Services. While it plays a film or an
  episode that has an IMDb id, or an anime played from a Kitsu id, Simkl is told what is playing and how far along it
  is; what you finish or mark watched goes to your Simkl history, and the list and rating you pick on a title page go
  to Simkl. With the Plan to Watch switch on, titles you add to your library are added to Simkl's Plan to Watch, and
  titles you remove leave it while they are still there. Your Simkl lists, history and ratings are read to show them,
  to import them and to bring in what you watch elsewhere. The sign-in stays on your device (the system's keychain
  where there is one) and never goes to Polarity's account server; unlinking revokes it and removes it.
- **Updates and the add-on list:** GitHub, to check for and download updates and to load the list of add-ons in
  Settings.
- **Sign-in check:** Cloudflare Turnstile, only if the account server asks for one before sending a login code.
- **Trailers:** IMDb's video files, or YouTube's player in its privacy-enhanced mode (youtube-nocookie.com), when
  you open a trailer.

The full list of data sources, with what each is used for, is in Settings → About → Credits.

## Watch parties

A watch party needs an account. Its messages pass through the account server's live connection; Polarity doesn't
store them. The other members see:

- each member's profile name and avatar, and who is host;
- what is playing (the title and episode), play, pause and position, and whether someone is loading;
- the name of the release you're playing, so others can pick the same one, but **never its stream link**. The one
  exception is a link you paste with "Watch a link": that link is sent to the members so their players can open it.

Anyone with the party code can join until the host locks the party.

## Your rights

Under the GDPR you can:

- **See** the data kept about you, and **get a copy** of it: write to the contact address above.
- **Correct** it: most of it you can change in the app (profiles, library, settings); for the rest, write to us.
- **Delete** it: Settings → Account → Delete account removes your account and everything stored with it on the
  account server, straight away. You can also ask by email.
- **Object** to how it's used, or ask us to limit it.
- **Complain** to the Dutch data protection authority, the
  [Autoriteit Persoonsgegevens](https://autoriteitpersoonsgegevens.nl), or the one where you live.

## Changes

When this policy changes, the new version is published here with its date, and the app's links lead to it.
