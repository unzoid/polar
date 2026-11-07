import { SimklSignedOut, type SimklCaller } from "./api";
import { getSimklLink, removeSimklLink, saveSimklLink, type SimklLink } from "./link";
import { refreshSimkl, revokeSimkl, simklViewer, type SimklTokens } from "./signIn";

/**
 * Linking a profile to Simkl (#86) and keeping the link usable: what the Settings row calls, and
 * what every signed-in request asks for first ({@link liveSimklLink}).
 */

export interface SimklLinkDeps {
  now: () => number;
  getLink: (space: string | null) => Promise<SimklLink | undefined>;
  saveLink: (space: string | null, link: SimklLink) => Promise<void>;
  removeLink: (space: string | null) => Promise<void>;
  refresh: (link: SimklLink, now: number) => Promise<SimklLink>;
  viewer: (caller: SimklCaller) => Promise<{ account: number; name: string }>;
  revoke: (refreshToken: string) => Promise<void>;
  /** After a link or an unlink: what else drops or starts with it (the sync, the queue, what the device kept). */
  changed: (space: string | null, linked: boolean) => void;
}

/** Simkl gave read-only access (the account refused changes, or the scope was cut): nothing could be sent. */
export class SimklReadOnly extends Error {
  constructor() {
    super("Simkl gave read-only access");
    this.name = "SimklReadOnly";
  }
}

const listeners = new Set<() => void>();
const linkHooks = new Set<(space: string | null, linked: boolean) => void>();

/** Hear when a profile links or unlinks Simkl; returns the function that stops listening. */
export function onSimklLinkChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tells whoever shows the link that it changed (a switch kept with it). */
export function simklLinkChanged() {
  listeners.forEach((l) => l());
}

/** The Simkl sync's own hook: runs first on every link and unlink, with the profile and which it was. */
export function onSimklLinked(hook: (space: string | null, linked: boolean) => void): () => void {
  linkHooks.add(hook);
  return () => linkHooks.delete(hook);
}

const realDeps = (): SimklLinkDeps => ({
  now: Date.now,
  getLink: getSimklLink,
  saveLink: saveSimklLink,
  removeLink: removeSimklLink,
  refresh: (link, now) => refreshSimkl(link, { now }),
  viewer: simklViewer,
  revoke: (refreshToken) => revokeSimkl(refreshToken),
  changed: (space, linked) => {
    linkHooks.forEach((h) => h(space, linked));
    listeners.forEach((l) => l());
  },
});

/** Refreshed this long before the access token runs out (Simkl's last 7 days). */
const REFRESH_AHEAD = 24 * 60 * 60_000;

/** The last lookup under way per profile: they run one after another, as each refresh cuts off the token before it. */
const lookups = new Map<string, Promise<SimklLink | undefined>>();

/**
 * The profile's Simkl link, ready to use: refreshed first when it runs out within a day, or with
 * `renew` (Simkl just refused it). `undefined` when there is none or Simkl refused the refresh,
 * which marks the link refused so Settings asks to sign in again; failing to reach Simkl throws,
 * unless the token in hand still works. Lookups for one profile wait for each other.
 */
export function liveSimklLink(space: string | null, renew = false, deps: SimklLinkDeps = realDeps()): Promise<SimklLink | undefined> {
  const key = space ?? "local";
  const before = lookups.get(key);
  const mine = (before ? before.catch(() => undefined) : Promise.resolve()).then(() => lookUp(space, renew, deps));
  lookups.set(key, mine);
  void mine.finally(() => lookups.get(key) === mine && lookups.delete(key)).catch(() => {});
  return mine;
}

async function lookUp(space: string | null, renew: boolean, deps: SimklLinkDeps): Promise<SimklLink | undefined> {
  const link = await deps.getLink(space);
  if (!link || link.refused) return undefined;
  const now = deps.now();
  if (!renew && link.expiresAt - now > REFRESH_AHEAD) return link;
  try {
    const fresh = await deps.refresh(link, now);
    await deps.saveLink(space, fresh);
    return fresh;
  } catch (e) {
    if (!(e instanceof SimklSignedOut)) {
      if (link.expiresAt > now && !renew) return link;
      throw e;
    }
    await deps.saveLink(space, { ...link, refused: true });
    deps.changed(space, true);
    return undefined;
  }
}

/**
 * Links the profile to the Simkl account that allowed the device code: asks Simkl who that is and
 * keeps the link. A sign-in without write access is revoked again and throws {@link SimklReadOnly}.
 */
export async function linkSimkl(space: string | null, tokens: SimklTokens, deps: SimklLinkDeps = realDeps()): Promise<SimklLink> {
  if (!tokens.canWrite) {
    await deps.revoke(tokens.refreshToken).catch(() => undefined);
    throw new SimklReadOnly();
  }
  const who = await deps.viewer({ token: tokens.token });
  const link: SimklLink = { token: tokens.token, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, account: who.account, name: who.name };
  // Signing the same account in again keeps its watchlist switch.
  const before = await deps.getLink(space).catch(() => undefined);
  if (before?.account === who.account && before.watchlist) link.watchlist = true;
  await deps.saveLink(space, link);
  deps.changed(space, true);
  return link;
}

/**
 * Unlinks the profile from Simkl: the sign-in is revoked at Simkl (when it can be reached) and
 * removed, and the hooks drop what was waiting to go out and what the device kept from Simkl.
 */
export async function unlinkSimkl(space: string | null, deps: SimklLinkDeps = realDeps()): Promise<void> {
  const link = await deps.getLink(space).catch(() => undefined);
  await deps.removeLink(space);
  deps.changed(space, false);
  if (link) await deps.revoke(link.refreshToken).catch(() => undefined);
}

/** The link's state as the Settings row says it. */
export type SimklLinkState = "none" | "linked" | "refused";

export const simklLinkState = (link: SimklLink | undefined): SimklLinkState => (!link ? "none" : link.refused ? "refused" : "linked");
