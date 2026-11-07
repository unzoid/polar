/**
 * The polarity:// links the /watch and /party pages open (#153, #208), made from the page's own
 * address and checked as strictly as Polarity checks them (src/lib/deepLink in the app): anything
 * else gives no link.
 */

/** /watch?type=series&id=tt0000000: IMDb, Kitsu or TMDB ids for movies and shows; AniList or MyAnimeList ids for anime. */
export function titleLink(search: string): string | null {
  const q = new URLSearchParams(search);
  const type = q.get("type");
  const id = q.get("id") ?? "";
  if ((type === "movie" || type === "series") && /^(tt\d{1,10}|kitsu:\d{1,9}|tmdb:[1-9]\d{0,9})$/.test(id)) {
    return `polarity://title/${type}/${encodeURIComponent(id)}`;
  }
  const anime = /^(anilist|mal):([1-9]\d{0,9})$/.exec(id);
  return type === "anime" && anime ? `polarity://anime/${anime[1]}/${anime[2]}` : null;
}

/** /party?t=<join token>: a watch party's join link from Discord. */
export function joinLink(search: string): string | null {
  const t = new URLSearchParams(search).get("t") ?? "";
  return /^[A-Za-z0-9_-]{43}$/.test(t) ? `polarity://party/${t}` : null;
}

/**
 * /party#u=<video link>&t=<seconds>&n=<page title>: watch a video together, from the browser
 * extension. In the fragment, so the video's address never reaches the website's server.
 */
export function togetherLink(hash: string): string | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const u = q.get("u") ?? "";
  const t = q.get("t") ?? "0";
  const n = (q.get("n") ?? "").slice(0, 200);
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || u.length > 2048 || !/^\d{1,6}$/.test(t)) return null;
  return `polarity://together?${new URLSearchParams({ u, t, ...(n ? { n } : {}) })}`;
}
