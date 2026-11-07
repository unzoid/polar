import { isRecord, num, str } from "../parse";
import { keychainStorage, type KeyStorage } from "../platform/keychain";

/**
 * A profile's Trakt sign-in (#85), kept in the system's keychain under `polar.link.trakt.<profile>`
 * (`local` when signed out of Polarity), else in the web view's storage under that name, like the
 * list services' links (lib/lists/linkStore.ts). Never synced to Polarity's database: each device
 * signs in itself, so two devices hold their own tokens and never use up each other's refresh token.
 */
export interface TraktLink {
  token: string;
  /** When the access token stops working, in ms since the epoch (Trakt: 7 days after it was made). */
  expiresAt: number;
  /** What gets a new pair of tokens; Trakt takes each one once. */
  refreshToken: string;
  /** The account, as Trakt names it: `slug` for addresses, `name` to show. */
  slug: string;
  name: string;
  /** The library and the Trakt watchlist kept in step (Settings → Services → Trakt), off until switched on. */
  watchlist?: boolean;
  /** Trakt refused the token before it ran out (revoked): signed in again before anything else is sent. */
  refused?: boolean;
}

export const traktLinkName = (space: string | null) => `polar.link.trakt.${space ?? "local"}`;

let storage: KeyStorage | undefined;
const store = () => (storage ??= keychainStorage());

/** Tests: where links are kept instead of the keychain. */
export function setTraktLinkStorage(s: KeyStorage | undefined) {
  storage = s;
}

export function readTraktLink(raw: unknown): TraktLink | undefined {
  if (typeof raw !== "string") return undefined;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(v)) return undefined;
  const [token, refreshToken, expiresAt, slug] = [str(v.token), str(v.refreshToken), num(v.expiresAt), str(v.slug)];
  if (!token || !refreshToken || expiresAt === undefined || !slug) return undefined;
  const link: TraktLink = { token, refreshToken, expiresAt, slug, name: str(v.name) ?? slug };
  if (v.watchlist === true) link.watchlist = true;
  if (v.refused === true) link.refused = true;
  return link;
}

/** The profile's Trakt link, read from the keychain once per run. */
export async function getTraktLink(space: string | null): Promise<TraktLink | undefined> {
  return readTraktLink(await store().getItem(traktLinkName(space)));
}

export function saveTraktLink(space: string | null, link: TraktLink): Promise<void> {
  return store().setItem(traktLinkName(space), JSON.stringify(link));
}

export function removeTraktLink(space: string | null): Promise<void> {
  return store().removeItem(traktLinkName(space));
}
