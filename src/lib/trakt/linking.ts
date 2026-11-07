import { TraktSignedOut, type TraktCaller } from "./api";
import { getTraktLink, removeTraktLink, saveTraktLink, type TraktLink } from "./link";
import { refreshTrakt, revokeTrakt, traktViewer, type TraktTokens } from "./signIn";

/**
 * Linking a profile to Trakt (#85) and keeping the link usable: what the Settings row calls, and
 * what every signed-in request asks for first ({@link liveTraktLink}).
 */

export interface TraktLinkDeps {
  now: () => number;
  getLink: (space: string | null) => Promise<TraktLink | undefined>;
  saveLink: (space: string | null, link: TraktLink) => Promise<void>;
  removeLink: (space: string | null) => Promise<void>;
  refresh: (link: TraktLink, now: number) => Promise<TraktLink>;
  viewer: (caller: TraktCaller) => Promise<{ slug: string; name: string }>;
  revoke: (token: string) => Promise<void>;
  /** After a link or an unlink: what else drops or starts with it (the sync, the queue, what the device kept). */
  changed: (space: string | null, linked: boolean) => void;
}

const listeners = new Set<() => void>();
const linkHooks = new Set<(space: string | null, linked: boolean) => void>();

/** Hear when a profile links or unlinks Trakt; returns the function that stops listening. */
export function onTraktLinkChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tells whoever shows the link that it changed (a switch kept with it). */
export function traktLinkChanged() {
  listeners.forEach((l) => l());
}

/** The Trakt sync's own hook: runs first on every link and unlink, with the profile and which it was. */
export function onTraktLinked(hook: (space: string | null, linked: boolean) => void): () => void {
  linkHooks.add(hook);
  return () => linkHooks.delete(hook);
}

const realDeps = (): TraktLinkDeps => ({
  now: Date.now,
  getLink: getTraktLink,
  saveLink: saveTraktLink,
  removeLink: removeTraktLink,
  refresh: (link, now) => refreshTrakt(link, { now }),
  viewer: traktViewer,
  revoke: (token) => revokeTrakt(token),
  changed: (space, linked) => {
    linkHooks.forEach((h) => h(space, linked));
    listeners.forEach((l) => l());
  },
});

/** Refreshed this long before the access token runs out (Trakt's last 7 days). */
const REFRESH_AHEAD = 24 * 60 * 60_000;

/** The last lookup under way per profile: they run one after another, as each refresh token works once. */
const lookups = new Map<string, Promise<TraktLink | undefined>>();

/**
 * The profile's Trakt link, ready to use: refreshed first when it runs out within a day, or with
 * `renew` (Trakt just refused it). `undefined` when there is none or Trakt refused the refresh,
 * which marks the link refused so Settings asks to sign in again; failing to reach Trakt throws,
 * unless the token in hand still works. Lookups for one profile wait for each other.
 */
export function liveTraktLink(space: string | null, renew = false, deps: TraktLinkDeps = realDeps()): Promise<TraktLink | undefined> {
  const key = space ?? "local";
  const before = lookups.get(key);
  const mine = (before ? before.catch(() => undefined) : Promise.resolve()).then(() => lookUp(space, renew, deps));
  lookups.set(key, mine);
  void mine.finally(() => lookups.get(key) === mine && lookups.delete(key)).catch(() => {});
  return mine;
}

async function lookUp(space: string | null, renew: boolean, deps: TraktLinkDeps): Promise<TraktLink | undefined> {
  const link = await deps.getLink(space);
  if (!link || link.refused) return undefined;
  const now = deps.now();
  if (!renew && link.expiresAt - now > REFRESH_AHEAD) return link;
  try {
    const fresh = await deps.refresh(link, now);
    await deps.saveLink(space, fresh);
    return fresh;
  } catch (e) {
    if (!(e instanceof TraktSignedOut)) {
      if (link.expiresAt > now && !renew) return link;
      throw e;
    }
    await deps.saveLink(space, { ...link, refused: true });
    deps.changed(space, true);
    return undefined;
  }
}

/** Links the profile to the Trakt account that allowed the device code: asks Trakt who that is and keeps the link. */
export async function linkTrakt(space: string | null, tokens: TraktTokens, deps: TraktLinkDeps = realDeps()): Promise<TraktLink> {
  const who = await deps.viewer({ token: tokens.token });
  const link: TraktLink = { ...tokens, slug: who.slug, name: who.name };
  // Signing the same account in again keeps its watchlist switch.
  const before = await deps.getLink(space).catch(() => undefined);
  if (before?.slug === who.slug && before.watchlist) link.watchlist = true;
  await deps.saveLink(space, link);
  deps.changed(space, true);
  return link;
}

/**
 * Unlinks the profile from Trakt: the token is revoked at Trakt (when it can be reached) and
 * removed, and the hooks drop what was waiting to go out and what the device kept from Trakt.
 */
export async function unlinkTrakt(space: string | null, deps: TraktLinkDeps = realDeps()): Promise<void> {
  const link = await deps.getLink(space).catch(() => undefined);
  await deps.removeLink(space);
  deps.changed(space, false);
  if (link) await deps.revoke(link.token).catch(() => undefined);
}

/** The link's state as the Settings row says it. */
export type TraktLinkState = "none" | "linked" | "refused";

export const traktLinkState = (link: TraktLink | undefined): TraktLinkState => (!link ? "none" : link.refused ? "refused" : "linked");
