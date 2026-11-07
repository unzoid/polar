/**
 * Links meant for Stremio (`stremio://…`, #163), which Polarity opens when the user turns on
 * Settings → Add-ons → "Open Stremio links in Polarity" (the shell registers the scheme,
 * src-tauri/src/stremio_links.rs). Polarity speaks the same add-on protocol and uses the same ids:
 *
 * - `stremio://addon.example.com/…/manifest.json` → an add-on's install link, standing for the same
 *   `https://` address. It only ever asks: the add-on is installed when the user presses Install
 *   (lib/deepLink/addonOffer.ts).
 * - `stremio:///detail/series/tt0000000` → that title's page; with a video id
 *   (`…/tt0000000/tt0000000:1:2`) that episode.
 * - Anything else is a link Polarity doesn't understand, and says so.
 *
 * Anything can open these, so they're parsed strictly, like polarity:// links (deepLink.ts).
 */
import type { ContentType } from "../types";
import { isSharedId } from "./deepLink";

export type StremioLink =
  | { kind: "addon"; manifestUrl: string }
  | { kind: "title"; type: ContentType; id: string; videoId?: string }
  /** `local`: an add-on on this device or the local network, which a link from outside doesn't install. */
  | { kind: "unknown"; local?: boolean };

export const STREMIO_SCHEME = "stremio://";

export const isStremioLink = (link: string) => link.trim().toLowerCase().startsWith(STREMIO_SCHEME);

/** A video id of `id`'s: `tt0000000:1:2` (season, episode) or `kitsu:42:3` (episode). */
const episodeOf = (id: string, videoId: string) => videoId.startsWith(`${id}:`) && /^(:\d{1,4}){1,2}$/.test(videoId.slice(id.length));

/** null: not a stremio:// link at all. */
export function parseStremioLink(link: string): StremioLink | null {
  const raw = link.trim();
  if (!isStremioLink(raw)) return null;
  const rest = raw.slice(STREMIO_SCHEME.length);
  // `stremio:///detail/…`, and `stremio://detail/…` as some pages write it.
  const title = /^\/?detail\/([^?#]*)$/.exec(rest);
  if (title) return titleLink(title[1]);
  return addonLink(rest) ?? { kind: "unknown" };
}

function titleLink(path: string): StremioLink {
  const parts = path.split("/").map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return "";
    }
  });
  const [type, id = "", videoId, ...more] = parts;
  if ((type !== "movie" && type !== "series") || !isSharedId(id) || more.length) return { kind: "unknown" };
  if (type === "series" && videoId && episodeOf(id, videoId)) return { kind: "title", type, id, videoId };
  // A movie's video id is the movie; an episode id that isn't this show's is left out.
  return { kind: "title", type, id };
}

function addonLink(rest: string): StremioLink | null {
  let url: URL;
  try {
    url = new URL(`https://${rest}`);
  } catch {
    return null;
  }
  if (rest.startsWith("/") || url.username || url.password || url.hash || !url.pathname.endsWith("/manifest.json")) return null;
  if (isLocalHost(url.hostname)) return { kind: "unknown", local: true };
  return { kind: "addon", manifestUrl: url.href };
}

/** This device, the local network, or an address that isn't a public name. */
export function isLocalHost(host: string) {
  // `localhost.` and `nas.local.` are the same names, written as fully qualified.
  const h = host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;
  if (!h.includes(".") && !h.includes(":")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  // IPv6: loopback, unique local, link-local, an IPv4 address inside one (mapped, compatible, NAT64).
  return h.includes(":") && (h.startsWith("::") || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith("64:ff9b:"));
}

export const STREMIO_NOTES = {
  unknown: "Polarity can't open this link meant for Stremio.",
  local: "This add-on link points at this device or your local network. To install it, paste its address into Settings → Add-ons → Install from URL.",
  off: "A link meant for Stremio opened Polarity. To open these here, turn on Open Stremio links in Polarity in Settings → Add-ons.",
} as const;

export interface StremioOpen {
  /** Settings → Add-ons → Open Stremio links in Polarity. */
  enabled: boolean;
  /** A title's page; `videoId`: that episode. */
  openTitle: (type: ContentType, id: string, videoId?: string) => void;
  /** Home, with a short note. */
  home: (note: string) => void;
  /** Asks whether to install (lib/deepLink/addonOffer.ts). */
  offerAddon: (manifestUrl: string) => void;
}

/** What a stremio:// link does; false if it isn't one. */
export function openStremioLink(raw: string, to: StremioOpen): boolean {
  const link = parseStremioLink(raw);
  if (!link) return false;
  if (!to.enabled) to.home(STREMIO_NOTES.off);
  else if (link.kind === "addon") to.offerAddon(link.manifestUrl);
  else if (link.kind === "title") to.openTitle(link.type, link.id, link.videoId);
  else to.home(link.local ? STREMIO_NOTES.local : STREMIO_NOTES.unknown);
  return true;
}
