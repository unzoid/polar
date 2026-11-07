import { isRecord, num, str } from "../parse";
import { keychainStorage, type KeyStorage } from "../platform/keychain";

/**
 * Which list services a profile has linked, with each one's sign-in (#83 AniList, #84 MyAnimeList). Kept per profile in
 * the system's keychain under `polar.link.<service>.<profile>` (`local` when signed out of
 * Polarity), else in the web view's storage under that name, as the Polarity sign-in is
 * (lib/platform/keychain.ts). Never synced to Polarity's database: each device signs in itself.
 */
export type ListService = "anilist" | "mal";
export const LIST_SERVICES: readonly ListService[] = ["anilist", "mal"];

export interface Link {
  token: string;
  /** When the token stops working, in ms since the epoch. */
  expiresAt: number;
  /** MyAnimeList: what gets a new token, and when it stops working too (ms). */
  refreshToken?: string;
  refreshBy?: number;
  /** The account on the service, as it named itself when the link was made. */
  userId: number;
  userName: string;
  /** The account's score format (AniList: `POINT_100`, `POINT_10_DECIMAL`, `POINT_10`, `POINT_5`, `POINT_3`; MyAnimeList: `POINT_10`). */
  scoreFormat: string;
  /** Whether the account shows adult entries; the import skips them otherwise. */
  adult: boolean;
  /** The service refused the token before it ran out (revoked): signed in again before anything else is sent. */
  refused?: boolean;
}

export const linkName = (service: ListService, space: string | null) => `polar.link.${service}.${space ?? "local"}`;

let storage: KeyStorage | undefined;
const store = () => (storage ??= keychainStorage());

/** Tests: where links are kept instead of the keychain. */
export function setLinkStorage(s: KeyStorage) {
  storage = s;
}

export function readLink(raw: unknown): Link | undefined {
  if (typeof raw !== "string") return undefined;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(v)) return undefined;
  const token = str(v.token);
  const expiresAt = num(v.expiresAt);
  const userId = num(v.userId);
  if (!token || expiresAt === undefined || userId === undefined) return undefined;
  const link: Link = {
    token,
    expiresAt,
    userId,
    userName: str(v.userName) ?? "",
    scoreFormat: str(v.scoreFormat) ?? "POINT_10",
    adult: v.adult === true,
  };
  const [refreshToken, refreshBy] = [str(v.refreshToken), num(v.refreshBy)];
  if (refreshToken && refreshBy !== undefined) Object.assign(link, { refreshToken, refreshBy });
  if (v.refused === true) link.refused = true;
  return link;
}

/** The profile's link to `service`, read from the keychain once per run. */
export async function getLink(service: ListService, space: string | null): Promise<Link | undefined> {
  return readLink(await store().getItem(linkName(service, space)));
}

/** What this run already knows of the link, without asking the keychain. */
export function peekLink(service: ListService, space: string | null): Link | undefined {
  return readLink(store().peek(linkName(service, space)));
}

export function saveLink(service: ListService, space: string | null, link: Link): Promise<void> {
  return store().setItem(linkName(service, space), JSON.stringify(link));
}

export function removeLink(service: ListService, space: string | null): Promise<void> {
  return store().removeItem(linkName(service, space));
}

/** Whether the link can be used now: not run out, not refused. */
export const usable = (link: Link | undefined, now: number): link is Link => !!link && !link.refused && link.expiresAt > now;

/** Whether the link still works, or can be refreshed into one that does. */
export const renewable = (link: Link | undefined, now: number): link is Link =>
  !!link && !link.refused && (link.expiresAt > now || (!!link.refreshToken && (link.refreshBy ?? 0) > now));
