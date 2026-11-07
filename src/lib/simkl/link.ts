import { isRecord, num, str } from "../parse";
import { keychainStorage, type KeyStorage } from "../platform/keychain";

/**
 * A profile's Simkl sign-in (#86), kept in the system's keychain under `polar.link.simkl.<profile>`
 * (`local` when signed out of Polarity), else in the web view's storage under that name, like the
 * other services' links (lib/lists/linkStore.ts, lib/trakt/link.ts). Never synced to Polarity's
 * database: each device signs in itself, so two devices never cut off each other's access token.
 */
export interface SimklLink {
  token: string;
  /** When the access token stops working, in ms since the epoch (Simkl: 7 days after it was made). */
  expiresAt: number;
  /** What gets a new access token; Simkl gives the same one back each time and keeps it 180 days from its last use. */
  refreshToken: string;
  /** The account, as Simkl names it: its number, and the name to show. */
  account: number;
  name: string;
  /** The library and the Simkl watchlist kept in step (Settings → Services → Simkl), off until switched on. */
  watchlist?: boolean;
  /** Simkl refused the token before it ran out (revoked): signed in again before anything else is sent. */
  refused?: boolean;
}

export const simklLinkName = (space: string | null) => `polar.link.simkl.${space ?? "local"}`;

let storage: KeyStorage | undefined;
const store = () => (storage ??= keychainStorage());

/** Tests: where links are kept instead of the keychain. */
export function setSimklLinkStorage(s: KeyStorage | undefined) {
  storage = s;
}

export function readSimklLink(raw: unknown): SimklLink | undefined {
  if (typeof raw !== "string") return undefined;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(v)) return undefined;
  const [token, refreshToken, expiresAt, account] = [str(v.token), str(v.refreshToken), num(v.expiresAt), num(v.account)];
  if (!token || !refreshToken || expiresAt === undefined || account === undefined) return undefined;
  const link: SimklLink = { token, refreshToken, expiresAt, account, name: str(v.name) || `Simkl ${account}` };
  if (v.watchlist === true) link.watchlist = true;
  if (v.refused === true) link.refused = true;
  return link;
}

/** The profile's Simkl link, from the keychain. */
export async function getSimklLink(space: string | null): Promise<SimklLink | undefined> {
  return readSimklLink(await store().getItem(simklLinkName(space)));
}

export function saveSimklLink(space: string | null, link: SimklLink): Promise<void> {
  return store().setItem(simklLinkName(space), JSON.stringify(link));
}

export function removeSimklLink(space: string | null): Promise<void> {
  return store().removeItem(simklLinkName(space));
}
