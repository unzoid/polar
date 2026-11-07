/**
 * Links into Polarity from outside (#153, #154): the buttons on someone's Discord profile point at
 * the website's /watch and /party pages, which open `polarity://…` (registered by the shell,
 * src-tauri/src/deep_link.rs) when Polarity is installed and show the download otherwise.
 *
 * - `https://getpolar.app/watch/?type=series&id=tt0000000` → `polarity://title/series/tt0000000`
 * - `https://getpolar.app/party/?t=<join token>` → `polarity://party/<join token>`
 *
 * Anything can open a polarity:// link, so it's parsed strictly here, and a link only ever opens
 * a title's page or asks a party to join (lib/party/discordJoin.ts): it plays nothing, installs
 * nothing and changes no setting by itself. Neither link carries a stream, an add-on or anything
 * about the person who shared it.
 */
import { isJoinToken } from "../party/discordJoin";
import type { ContentType } from "../types";

export const SITE = "https://getpolar.app";

export type DeepLink = { kind: "title"; type: ContentType; id: string } | { kind: "party"; token: string };

/** Ids others' Polarity can open on their own: IMDb's and Kitsu's (docs/anime-identity.md). */
const SHARED_ID = /^(tt\d{1,10}|kitsu:\d{1,9})$/;

export const isSharedId = (id: string) => SHARED_ID.test(id);

export function parseDeepLink(link: string): DeepLink | null {
  const m = /^polarity:\/\/(title|party)\/([^?#]*)$/.exec(link.trim());
  if (!m) return null;
  const parts = m[2].split("/").map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return "";
    }
  });
  if (m[1] === "title") {
    const [type, id, ...rest] = parts;
    return (type === "movie" || type === "series") && isSharedId(id ?? "") && !rest.length ? { kind: "title", type, id } : null;
  }
  return parts.length === 1 && isJoinToken(parts[0]) ? { kind: "party", token: parts[0] } : null;
}

/** "Watch in Polarity": the website's page for this title; null for one others couldn't open. */
export function watchPage(type: ContentType, id: string) {
  return isSharedId(id) ? `${SITE}/watch/?${new URLSearchParams({ type, id })}` : null;
}

/** "Join watch party": the website's page for a join token. */
export const partyPage = (token: string) => `${SITE}/party/?${new URLSearchParams({ t: token })}`;
