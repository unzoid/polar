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
- **Signing in on a TV with a code** (Settings → Account → Sign in a TV): while a code is waiting, at most five
  minutes, the server keeps the kind of device that asked (for example "Android TV"), a scrambled form of its IP
  address (to limit how many codes one address can ask for) and, once you approve, which account approved it. It's
  deleted when the TV signs in, or when the code expires. Each code you look up is counted for ten minutes, to stop
  guessing.
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
- **Notifications**, if you turn any on (Settings → Notifications, off by default): which episodes of the shows you
  follow were already out, so the next check can tell what's new. The checks look those shows up as title pages do;
  the notes are shown by your system, and there is no notification server.
- **Caches** of catalog and anime data (most kept up to a day, the anime id list a week). Settings → About → Cache
  shows and clears them.
- **Downloads**, **local files** you open (and their Recent files list and where you stopped in them), and the
  **Stremio export file** if you import one: it's read on your device and only the library and add-ons you choose are
  kept.
- **API keys and add-on links** on your device are kept in the system's keychain where there is one.
- **Discord Rich Presence** talks only to the Discord app on the same computer, while something plays. By default it
  shows only that you're watching something in Polarity, no title; in Settings → Playback → Show on Discord you can
  turn it off, or choose to show the title you're watching. What it shows appears on your Discord profile, so Discord
  and the people who can see your profile see it, under [Discord's privacy policy](https://discord.com/privacy).
  People who see it also see up to two buttons:
  - **Watch in Polarity** (only when it shows the title): a link to a page on getpolar.app carrying the title's
    public id (IMDb's or Kitsu's), which opens that title in their own Polarity.
  - **Join watch party** (only while you're in a watch party and "Who can join from Discord" isn't Nobody): a
    link to a page on getpolar.app carrying a random join token, not your party code. A token is replaced every
    ten minutes and stops working ten minutes after that, or when you leave the party. Someone who opens it asks
    your Polarity to join, under the name of their Polarity profile; with "Ask me" (the default) you see that name
    and allow or decline, with "Anyone who sees it" they're let in. Only someone let in receives the party code,
    encrypted so that only their app can read it.

  Those pages only open Polarity on the visitor's computer (or offer the download): they look nothing up about
  you or the title. Neither button carries stream links, add-on links or anything about you.

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
  you ask them about. Add-ons with a catalog that takes a search also receive what you type in search. Polarity
  doesn't choose, check or vouch for them.
- **Torrent playback:** while a torrent source plays (and afterwards, only if you turned on Keep sharing after playback), the
  other people in that torrent see your IP address and which pieces of the file you download and upload.
- **Updates and the add-on list:** GitHub, to check for and download updates and to load the list of add-ons in
  Settings.
- **Sign-in check:** Cloudflare Turnstile, only if the account server asks for one before sending a login code.
- **Trailers and YouTube links:** IMDb's video files, or YouTube's player in its privacy-enhanced mode
  (youtube-nocookie.com), when you open a trailer or play a YouTube link put on with "Watch a link".

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
