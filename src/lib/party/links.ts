/**
 * A link the user pastes to watch together (#136): a video file or an HLS/DASH stream on the web, or a
 * YouTube video, which plays in YouTube's own embedded player (#201). Each
 * member's player opens it itself; nothing goes through the host. Pure, so it's tested without a room
 * (tests/partyLinks.test.ts).
 */
import { canEmbedOtherSites, os, type Os } from "../platform/device";
import type { PartyMedia } from "./messages";

/** Ids of a pasted link: `link:` and a hash of the URL, so the room can tell links apart without the URL in ids. */
export const LINK_PREFIX = "link:";
export const isLinkId = (id: string) => id.startsWith(LINK_PREFIX);

/** Longer links are someone's mistake or mischief. */
export const LINK_MAX = 2048;

/** Streams whose type a server may give as text or XML, which a check for "a page, not a video" would refuse. */
const STREAM_PATH = /\.(m3u8|mpd)$/i;
export const isStreamLink = (url: string) => {
  try {
    return STREAM_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

export type LinkCheck = { ok: true; url: string } | { ok: false; reason: string };

/** Whether `input` is a link the room can share: a web address, without a sign-in in it. A YouTube video's comes back as its one address. */
export function checkLink(input: string): LinkCheck {
  const text = input.trim();
  if (!text) return { ok: false, reason: "Paste a link to a video." };
  if (text.length > LINK_MAX) return { ok: false, reason: "That link is too long." };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "That isn't a link. Links start with https://" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Only web links (https://) can be watched together." };
  // Everyone in the room sees the link: a name and password in it would be shared with them.
  if (url.username || url.password) return { ok: false, reason: "This link has a sign-in in it. It would be shown to everyone, so it isn't shared." };
  const yt = youtubeId(url.href);
  return { ok: true, url: yt ? youtubeLink(yt) : url.href };
}

/** A short, stable hash of `text` (two 32-bit FNV-1a passes), for ids that mustn't carry the text itself. */
export function shortHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/** A link's id: the prefix and a hash of the URL. */
export const linkId = (url: string): string => `${LINK_PREFIX}${shortHash(url)}`;

/** What a link is called where a title would be: its host and file name ("media.example.com · talk.mp4"). */
export function linkLabel(url: string): string {
  if (youtubeId(url)) return "YouTube video";
  try {
    const u = new URL(url);
    const file = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    return file ? `${u.host} · ${file}` : u.host;
  } catch {
    return url;
  }
}

/** The room's media for a link. */
export function linkMedia(url: string): PartyMedia {
  const id = linkId(url);
  return { type: "movie", metaId: id, videoId: id, url, label: linkLabel(url) };
}

/** YouTube's hosts for a video people paste (#201): watch pages, youtu.be, Shorts, live pages and embeds. */
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
/** A YouTube video id: eleven of these characters. */
const YOUTUBE_ID = /^[\w-]{11}$/;

/** The YouTube video a link is to, if it is one (`watch?v=`, youtu.be, `/shorts/`, `/live/`, `/embed/`). Any other YouTube page is no video. */
export function youtubeId(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  let id: string | null | undefined;
  if (host === "youtu.be" || host === "www.youtu.be") id = parts.length === 1 ? parts[0] : undefined;
  else if (YOUTUBE_HOSTS.has(host)) {
    if (parts.length === 1 && parts[0] === "watch") id = u.searchParams.get("v");
    else if (parts.length === 2 && ["shorts", "live", "embed"].includes(parts[0])) id = parts[1];
  }
  return id && YOUTUBE_ID.test(id) ? id : undefined;
}

/** The one address a YouTube video goes by in the room, however it was pasted: the same video is the same link. */
export const youtubeLink = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** Why a YouTube video's link can't be watched here, if it can't: on Android YouTube's player opens outside the app. */
export function youtubeLinkProblem(url: string, o: Os = os): string | undefined {
  if (!youtubeId(url) || canEmbedOtherSites(o)) return undefined;
  return "On Android, YouTube videos open in YouTube, so they can't be watched together here.";
}
