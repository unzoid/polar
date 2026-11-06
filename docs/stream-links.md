# Links served over HTTP

What a stream with a `url` needs to play well in Polarity, for people who write add-ons or run
their own file server (plain HTTP or WebDAV: to the player both are a file at a link). The
player is mpv on Windows, macOS and Android, and the built-in `<video>` player elsewhere
(docs/ARCHITECTURE.md §3).

## Seeking

The file server should answer `Range` requests with `206 Partial Content` and a
`Content-Range` header. mpv then seeks by asking for the bytes it needs; a server that always
answers `200` with the whole file can still be played from the start, but seeking means
reading up to that point.

## Redirects

Before the player opens a link, the app follows its redirects (at most 10) and hands the
player the final link (`crates/addon/src/probe.rs`). Each hop shows on the loading screen by
its host only.

## Logins

Playback sends only `User-Agent`, `Referer` and `Origin` from the stream's
`behaviorHints.proxyHeaders.request`, never `Authorization` or `Cookie`
(`crates/player/src/headers.rs`): those headers would go to every host the player talks to
while the file plays. A file server that wants a login takes it from the link instead:

- put it in the link, `https://user:password@files.example.com/film.mkv`, or in the link
  the add-on redirects to;
- the server answers a request without it with `401` and `WWW-Authenticate: Basic`. The
  app's link check sends the login as Basic auth straight away; mpv sends it in answer to
  that challenge;
- a redirect to another host carries the login only if the new link has it.

The loading screen and "Copy details" show the host of such a link, never the login.

The built-in player plays through the system's web view, which may refuse a video link with
a login in it (see docs/unverified.md); mpv plays it.

## Slow servers

A server that opens the file on demand can take seconds to send the first byte. The link
check waits up to 20 s for an answer and 25 s in all, then lets the player try the link
anyway; mpv waits up to 30 s for the network (`--network-timeout`). The look ahead of time in
the source list (#21) gives a link 3 s: one that hasn't answered by then reads "Slow to
answer" and isn't dimmed like a source that failed.

## File name and size

`behaviorHints.filename` and `behaviorHints.videoSize` (bytes) are used when the add-on sends
them:

- the size in the source list is `videoSize` when it's there, before a size written in the
  stream's text;
- the file name fills in resolution, codec, tags and who made the file when the stream's
  name and title don't say;
- both go to subtitle add-ons as the `videoSize` and `filename` extra arguments of the
  subtitles request, so they can match subtitles to the file.

## Not supported

Streams that need the app to download and unpack the file itself (`nzbUrl` with `servers`)
have no `url`, so they are left out of the source list like any stream with nothing to play.

## Trying it

`scripts/open-films-addon.ts` serves a local file the way such a server would:

```sh
bun scripts/open-films-addon.ts --file tt1254207=/path/to/big_buck_bunny.mov \
  --auth user:secret --slow 10 --host 0.0.0.0
```

Its link answers `302` after 10 s with the login in the new link, and the file answers `401`
without the login. Add the add-on in Polarity by this computer's network address (the app
doesn't check links to `127.0.0.1`), play Big Buck Bunny, seek, stop and resume.
