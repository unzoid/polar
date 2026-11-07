/**
 * Links into Polarity from outside (#153, #154): the buttons on someone's Discord profile point at
 * the website's /watch and /party pages, which open `polarity://…` (registered by the shell,
 * src-tauri/src/deep_link.rs) when Polarity is installed and show the download otherwise.
 *
 * - `https://getpolar.app/watch/?type=series&id=tt0000000` → `polarity://title/series/tt0000000`
 * - `https://getpolar.app/party/?t=<join token>` → `polarity://party/<join token>`
 *
 * The browser extension's buttons (#208, extension/) use the same pages, and two more links:
 *
 * - a title on a database site by that site's id: `polarity://title/movie/tmdb:603` (TMDB's id, looked
 *   up with the user's TMDB key), `polarity://anime/anilist/21` and `polarity://anime/mal/21`;
 * - a video to watch together: `polarity://together?u=<video link>&t=<seconds in>&n=<page title>`, from
 *   the /party page's fragment, for a YouTube video or a direct video link (Watch a Link, #201).
 *
 * Anything can open a polarity:// link, so it's parsed strictly here, and a link only ever opens
 * a title's page, asks a party to join (lib/party/discordJoin.ts) or asks whether to watch a video
 * together (lib/party/together.ts): it plays nothing, installs nothing and changes no setting by
 * itself. No link carries an add-on or anything about the person who shared it.
 */
import { isJoinToken } from "../party/discordJoin";
import { checkLink } from "../party/links";
import type { ContentType } from "../types";

export const SITE = "https://getpolar.app";

/** A watch-together link's start, at most a day in; the title a page gave, at most this long. */
const MAX_AT = 24 * 60 * 60;
const MAX_NAME = 200;

export type DeepLink =
  | { kind: "title"; type: ContentType; id: string }
  | { kind: "tmdb"; type: ContentType; id: number }
  | { kind: "anime"; source: "anilist" | "mal"; id: number }
  | { kind: "party"; token: string }
  | { kind: "together"; url: string; at: number; name?: string };

/** Ids others' Polarity can open on their own: IMDb's and Kitsu's (docs/anime-identity.md). */
const SHARED_ID = /^(tt\d{1,10}|kitsu:\d{1,9})$/;

export const isSharedId = (id: string) => SHARED_ID.test(id);

const TMDB_ID = /^tmdb:([1-9]\d{0,9})$/;
const NUMBER = /^[1-9]\d{0,9}$/;

export function parseDeepLink(link: string): DeepLink | null {
  const text = link.trim();
  if (text.startsWith("polarity://together?")) return parseTogether(text.slice("polarity://together?".length));
  const m = /^polarity:\/\/(title|anime|party)\/([^?#]*)$/.exec(text);
  if (!m) return null;
  const parts = m[2].split("/").map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return "";
    }
  });
  if (m[1] === "title") {
    const [type, id = "", ...rest] = parts;
    if ((type !== "movie" && type !== "series") || rest.length) return null;
    const tmdb = TMDB_ID.exec(id);
    return tmdb ? { kind: "tmdb", type, id: Number(tmdb[1]) } : isSharedId(id) ? { kind: "title", type, id } : null;
  }
  if (m[1] === "anime") {
    const [source, id = "", ...rest] = parts;
    return (source === "anilist" || source === "mal") && NUMBER.test(id) && !rest.length ? { kind: "anime", source, id: Number(id) } : null;
  }
  return parts.length === 1 && isJoinToken(parts[0]) ? { kind: "party", token: parts[0] } : null;
}

/** `u` a web link the room can share (checkLink), `t` whole seconds in, `n` the page's title as plain text. */
function parseTogether(query: string): DeepLink | null {
  if (query.includes("#")) return null;
  const q = new URLSearchParams(query);
  if ([...q.keys()].some((k) => !["u", "t", "n"].includes(k)) || q.getAll("u").length !== 1 || q.getAll("t").length > 1 || q.getAll("n").length > 1) return null;
  const link = checkLink(q.get("u")!);
  if (!link.ok) return null;
  const t = q.get("t") ?? "0";
  if (!/^\d{1,6}$/.test(t)) return null;
  // Control and direction characters out: it's shown as a line of text, and only as what the page called itself.
  const name = (q.get("n") ?? "").replace(/\s+/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, MAX_NAME);
  return { kind: "together", url: link.url, at: Math.min(Number(t), MAX_AT), ...(name ? { name } : {}) };
}

/** "Watch in Polarity": the website's page for this title; null for one others couldn't open. */
export function watchPage(type: ContentType, id: string) {
  return isSharedId(id) ? `${SITE}/watch/?${new URLSearchParams({ type, id })}` : null;
}

/** "Join watch party": the website's page for a join token. */
export const partyPage = (token: string) => `${SITE}/party/?${new URLSearchParams({ t: token })}`;
