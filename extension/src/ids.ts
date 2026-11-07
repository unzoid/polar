/**
 * What the extension reads from a page's address, and the links it opens (#208). Pure, so it's
 * tested on its own (extension/tests/ids.test.ts). Nothing here reads a page or touches the network.
 *
 * Polarity checks every link again on its side (src/lib/deepLink in the app), and asks before it
 * starts a watch party; these rules only decide where the button shows.
 */

export type ContentType = "movie" | "series";

/** A title Polarity can open: by IMDb or TMDB id for movies and shows, by AniList or MyAnimeList id for anime. */
export type Title = { db: "imdb"; type: ContentType; id: string } | { db: "tmdb"; type: ContentType; id: number } | { db: "anilist" | "mal"; id: number };

/** The website's pages that hand a link to Polarity, or offer the download when it isn't installed. */
export const SITE = "https://getpolar.app";

/** Longer links are someone's mistake; Polarity refuses them too. */
export const LINK_MAX = 2048;

const host = (u: URL) => u.hostname.replace(/^(www|m)\./, "");

function parse(href: string): URL | null {
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * IMDb's `og:type` for a title page: a film or a show. An episode, a game or anything else gets no
 * button: Polarity opens films and shows.
 */
export function imdbType(ogType: string | null | undefined): ContentType | null {
  return ogType === "video.movie" ? "movie" : ogType === "video.tv_show" ? "series" : null;
}

/**
 * The title a database page is about, from its address alone: IMDb (`/title/tt…`, with IMDb's own
 * `og:type` for movie or show), TMDB (`/movie/<id>`, `/tv/<id>`), AniList and MyAnimeList
 * (`/anime/<id>`). A list, a search, a person or a title's sub-page (cast, reviews…) is no title.
 */
export function titleFromAddress(href: string, ogType?: string | null): Title | null {
  const u = parse(href);
  if (!u) return null;
  const path = u.pathname;
  let m: RegExpExecArray | null;
  switch (host(u)) {
    case "imdb.com": {
      // In English at /title/…, in other languages at /fr/title/…, /es-es/title/…
      if (!(m = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/title\/(tt\d{1,10})\/?$/.exec(path))) return null;
      const type = imdbType(ogType);
      return type ? { db: "imdb", type, id: m[1] } : null;
    }
    case "themoviedb.org":
      // An optional language prefix isn't TMDB's; its title pages are /movie/603-slug and /tv/1399-slug.
      if (!(m = /^\/(movie|tv)\/([1-9]\d{0,9})(?:-[^/]*)?\/?$/.exec(path))) return null;
      return { db: "tmdb", type: m[1] === "tv" ? "series" : "movie", id: Number(m[2]) };
    case "anilist.co":
      if (!(m = /^\/anime\/([1-9]\d{0,9})(?:\/[^/]+)?\/?$/.exec(path))) return null;
      return { db: "anilist", id: Number(m[1]) };
    case "myanimelist.net":
      if (!(m = /^\/anime\/([1-9]\d{0,9})(?:\/[^/]+)?\/?$/.exec(path))) return null;
      return { db: "mal", id: Number(m[1]) };
  }
  return null;
}

/** Trakt's list pages, which sit where a title's slug would. */
const TRAKT_LISTS = new Set(["trending", "popular", "favorited", "recommended", "watched", "collected", "anticipated", "boxoffice", "streaming", "calendar", "new", "premieres"]);

/**
 * Trakt's and Letterboxd's title pages have no id Polarity uses in their address, but link the
 * title's IMDb and TMDB pages: those links (`hrefs`, from the page's own links to imdb.com and
 * themoviedb.org) give it. `null` on any other page of theirs.
 */
export function titleFromLinks(href: string, hrefs: readonly string[]): Title | null {
  const u = parse(href);
  if (!u) return null;
  const site = host(u);
  let type: ContentType | null = null;
  if (site === "trakt.tv" || site === "app.trakt.tv") {
    const m = /^\/(movies|shows)\/([^/]+)\/?$/.exec(u.pathname);
    if (!m || TRAKT_LISTS.has(m[2])) return null;
    type = m[1] === "shows" ? "series" : "movie";
  } else if (site === "letterboxd.com") {
    if (!/^\/film\/[^/]+\/?$/.exec(u.pathname)) return null;
  } else {
    return null;
  }
  let tmdb: { type: ContentType; id: number } | null = null;
  let imdb: string | null = null;
  for (const raw of hrefs) {
    const link = parse(raw);
    if (!link) continue;
    const m = host(link) === "imdb.com" ? /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/title\/(tt\d{1,10})\/?$/.exec(link.pathname) : null;
    if (m && !imdb) imdb = m[1];
    const t = host(link) === "themoviedb.org" ? /^\/(movie|tv)\/([1-9]\d{0,9})(?:-[^/]*)?\/?$/.exec(link.pathname) : null;
    if (t && !tmdb) tmdb = { type: t[1] === "tv" ? "series" : "movie", id: Number(t[2]) };
  }
  // Letterboxd says what it is through TMDB's link: a film, or now and then a series.
  type ??= tmdb?.type ?? "movie";
  if (imdb) return { db: "imdb", type, id: imdb };
  return tmdb ? { db: "tmdb", type, id: tmdb.id } : null;
}

/** "Open in Polarity": the website's /watch page for the title. */
export function openPage(title: Title): string {
  const q =
    title.db === "imdb"
      ? { type: title.type, id: title.id }
      : title.db === "tmdb"
        ? { type: title.type, id: `tmdb:${title.id}` }
        : { type: "anime", id: `${title.db}:${title.id}` };
  return `${SITE}/watch/?${new URLSearchParams(q)}`;
}

const YOUTUBE_HOSTS = new Set(["youtube.com"]);
const YOUTUBE_ID = /^[\w-]{11}$/;

/** The video a YouTube page is: `watch?v=`, `/shorts/`, `/live/`, or a youtu.be link. Any other YouTube page is none. */
export function youtubeVideo(href: string): string | null {
  const u = parse(href);
  if (!u) return null;
  const site = host(u);
  if (site === "youtu.be") {
    const id = u.pathname.slice(1);
    return YOUTUBE_ID.test(id) ? id : null;
  }
  if (!YOUTUBE_HOSTS.has(site)) return null;
  if (u.pathname === "/watch") {
    const v = u.searchParams.get("v") ?? "";
    return YOUTUBE_ID.test(v) ? v : null;
  }
  const m = /^\/(shorts|live)\/([\w-]{11})\/?$/.exec(u.pathname);
  return m ? m[2] : null;
}

/** File and stream types Watch a Link plays (#201): the context menu shows only on links ending in one. */
export const VIDEO_TYPES = ["mp4", "mkv", "webm", "m3u8", "mpd"] as const;
const VIDEO_PATH = new RegExp(`\\.(${VIDEO_TYPES.join("|")})$`, "i");

/** A direct link to a video file or stream that can be watched together: a web address, with no sign-in in it. */
export function isVideoAddress(href: string | undefined): href is string {
  if (!href || href.length > LINK_MAX) return false;
  const u = parse(href);
  return !!u && !u.username && !u.password && VIDEO_PATH.test(u.pathname);
}

/** The browser's match patterns for those links, upper and lower case, with or without a query. */
export const VIDEO_PATTERNS = VIDEO_TYPES.flatMap((t) => [t, t.toUpperCase()]).flatMap((t) => [`*://*/*.${t}`, `*://*/*.${t}?*`]);

/** What a page called itself, as one plain line: Polarity shows it on its question as the page's words. */
export function pageName(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/ - YouTube$/, "")
    .trim()
    .slice(0, 200);
}

/**
 * "Watch together in Polarity": the website's /party page with the video in its fragment, so the
 * address never reaches the website's server. `at` is where the browser was, in whole seconds.
 */
export function togetherPage(url: string, at = 0, name = ""): string {
  const q = new URLSearchParams({ u: url, t: String(Math.max(0, Math.floor(at) || 0)) });
  const n = pageName(name);
  if (n) q.set("n", n);
  return `${SITE}/party/#${q}`;
}

/** A YouTube video's one address, as Polarity keeps it. */
export const youtubeLink = (id: string) => `https://www.youtube.com/watch?v=${id}`;
