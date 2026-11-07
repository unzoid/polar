import { changedSince, deleteEntry, entryFor, saveEntry, viewer, wholeList } from "./anilistList";
import { SignedOut, type Caller, type EntryChange, type ListEntry, type ListStatus, type Viewer } from "./entry";
import { getLink, renewable, saveLink, type Link, type ListService } from "./linkStore";
import { malChangedSince, malDeleteEntry, malEntryFor, malSaveEntry, malViewer, malWholeList } from "./malList";
import { refreshMal } from "./malSignIn";

/**
 * The list services a profile can link (#83 AniList, #84 MyAnimeList), each as the same set of
 * calls, so the queue, the list sync, the import and the screens work the same for both.
 */
export interface ListClient {
  service: ListService;
  /** The service's name, as the screens say it. */
  name: string;
  /** Its own names of Polarity's statuses, as its site says them for anime. */
  statusNames: Record<ListStatus, string>;
  /** Which of an anime's ids (lib/library/identity.ts AnimeLink, ani.zip, the id lists) is this service's. */
  idKey: "anilist" | "mal";
  viewer: (caller: Caller) => Promise<Viewer>;
  entryFor: (userId: number, mediaId: number, caller: Caller) => Promise<ListEntry | null>;
  saveEntry: (mediaId: number, change: EntryChange, caller: Caller) => Promise<ListEntry>;
  deleteEntry: (entryId: number, caller: Caller) => Promise<void>;
  wholeList: (userId: number, caller: Caller) => Promise<ListEntry[]>;
  changedSince: (userId: number, since: number, caller: Caller) => Promise<ListEntry[]>;
  /** New tokens for a link that can be refreshed (MyAnimeList); AniList's can't. */
  refresh?: (link: Link, now: number) => Promise<Link>;
}

const anilist: ListClient = {
  service: "anilist",
  name: "AniList",
  statusNames: { CURRENT: "Watching", PLANNING: "Plan to watch", COMPLETED: "Completed", PAUSED: "Paused", DROPPED: "Dropped", REPEATING: "Rewatching" },
  idKey: "anilist",
  viewer,
  entryFor,
  saveEntry,
  deleteEntry,
  wholeList,
  changedSince,
};

const mal: ListClient = {
  service: "mal",
  name: "MyAnimeList",
  statusNames: { CURRENT: "Watching", PLANNING: "Plan to Watch", COMPLETED: "Completed", PAUSED: "On-Hold", DROPPED: "Dropped", REPEATING: "Re-watching" },
  idKey: "mal",
  viewer: malViewer,
  entryFor: malEntryFor,
  saveEntry: malSaveEntry,
  deleteEntry: malDeleteEntry,
  wholeList: malWholeList,
  changedSince: malChangedSince,
  refresh: async (link, now) => {
    if (!link.refreshToken) throw new SignedOut("MyAnimeList");
    return { ...link, ...(await refreshMal(link.refreshToken, now)) };
  },
};

const CLIENTS: Record<ListService, ListClient> = { anilist, mal };

export const listClient = (service: ListService): ListClient => CLIENTS[service];

/** Refreshed this long before the token runs out, so a request never meets an expired one. */
const REFRESH_AHEAD = 2 * 24 * 60 * 60_000;

export interface LiveLinkDeps {
  now: () => number;
  getLink: (service: ListService, space: string | null) => Promise<Link | undefined>;
  saveLink: (service: ListService, space: string | null, link: Link) => Promise<void>;
  client: (service: ListService) => ListClient;
}

const realDeps = (): LiveLinkDeps => ({ now: Date.now, getLink, saveLink, client: listClient });

/** The last lookup under way per service and profile: they run one after another, as MAL revokes a refresh token once it is used. */
const lookups = new Map<string, Promise<Link | undefined>>();

/**
 * The profile's link to `service`, ready to use: refreshed first when it runs out soon, or with
 * `renew` (the service just refused it). `undefined` when there is none or it can't be used; a
 * refresh the service refuses marks the link refused, so Settings asks to sign in again; one that
 * can't reach the service throws, unless the token in hand still works. Lookups
 * for one profile wait for each other, so two at once refresh once: the second finds the new link.
 */
export function liveLink(service: ListService, space: string | null, renew = false, deps: LiveLinkDeps = realDeps()): Promise<Link | undefined> {
  const key = `${service}.${space ?? "local"}`;
  const before = lookups.get(key);
  const mine = (before ? before.catch(() => undefined) : Promise.resolve()).then(() => lookUp(service, space, renew, deps));
  lookups.set(key, mine);
  void mine.finally(() => lookups.get(key) === mine && lookups.delete(key)).catch(() => {});
  return mine;
}

async function lookUp(service: ListService, space: string | null, renew: boolean, deps: LiveLinkDeps): Promise<Link | undefined> {
  const link = await deps.getLink(service, space);
  const now = deps.now();
  if (!renewable(link, now)) return undefined;
  const { refresh } = deps.client(service);
  if (!refresh || !link.refreshToken) return renew || link.expiresAt <= now ? undefined : link;
  if (!renew && link.expiresAt - now > REFRESH_AHEAD) return link;
  try {
    const fresh = await refresh(link, now);
    await deps.saveLink(service, space, fresh);
    return fresh;
  } catch (e) {
    // Not reached, or MAL busy: the token still in hand when it is good, else the failure (tried again later).
    if (!(e instanceof SignedOut)) {
      if (link.expiresAt > now && !renew) return link;
      throw e;
    }
    await deps.saveLink(service, space, { ...link, refused: true });
    return undefined;
  }
}
