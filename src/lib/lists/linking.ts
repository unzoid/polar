import { viewer as askViewer, type Caller, type EntryChange, type ListEntry, type ListStatus, type Viewer } from "./anilistList";
import { getLink, removeLink, saveLink, type Link } from "./linkStore";
import { forgetListEntries, keepEntry, syncList } from "./listSync";
import { clearQueue, enqueue } from "./queue";
import { readSignIn } from "./signIn";

/**
 * Linking a profile's AniList account and changing its entries from Polarity (#83): what the
 * Settings row and the anime page's list panel call. Changes go through the profile's queue
 * (queue.ts), so one made offline goes out later.
 */

/** What the user pasted holds no sign-in, or one already run out. */
export class NotASignIn extends Error {
  constructor() {
    super("That isn't an AniList sign-in code");
    this.name = "NotASignIn";
  }
}

export interface LinkingDeps {
  now: () => number;
  viewer: (caller: Caller) => Promise<Viewer>;
  saveLink: (space: string | null, link: Link) => Promise<void>;
  removeLink: (space: string | null) => Promise<void>;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** After a link or an unlink: the list sync and whoever shows the link. */
  changed: (space: string | null) => void;
}

const listeners = new Set<() => void>();

/** Hear when a profile links or unlinks AniList; returns the function that stops listening. */
export function onLinkChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const realDeps = (): LinkingDeps => ({
  now: Date.now,
  viewer: askViewer,
  saveLink: (space, link) => saveLink("anilist", space, link),
  removeLink: (space) => removeLink("anilist", space),
  storage: localStorage,
  changed: () => {
    listeners.forEach((l) => l());
    void syncList(true);
  },
});

/**
 * Links the profile to the AniList account whose sign-in `pasted` holds (the PIN page's code, or
 * the link the browser opened back into the app): asks AniList who that is, keeps the link, and
 * sends what was queued meanwhile. Throws {@link NotASignIn}, or what AniList answered.
 */
export async function linkAniList(space: string | null, pasted: string, deps: LinkingDeps = realDeps()): Promise<Link> {
  const signIn = readSignIn(pasted, deps.now());
  if (!signIn) throw new NotASignIn();
  const who = await deps.viewer({ token: signIn.token });
  const link: Link = { ...signIn, userId: who.id, userName: who.name, scoreFormat: who.scoreFormat, adult: who.adult };
  await deps.saveLink(space, link);
  deps.changed(space);
  return link;
}

/** Unlinks the profile: the token, the changes still waiting and what the device kept of the list all go. */
export async function unlinkAniList(space: string | null, deps: LinkingDeps = realDeps()): Promise<void> {
  await deps.removeLink(space);
  clearQueue(space, deps.storage);
  forgetListEntries(space);
  deps.changed(space);
}

/**
 * Changes the profile's entry for `mediaId` from the anime page: queued and sent, and kept on the
 * device as AniList will have it, so the page shows it at once. Returns that entry.
 */
export function changeEntry(space: string | null, mediaId: number, before: ListEntry | null, change: EntryChange, now = Date.now()): ListEntry {
  const after: ListEntry = {
    id: before?.id ?? 0,
    mediaId,
    status: change.status ?? before?.status ?? "PLANNING",
    progress: change.progress ?? before?.progress ?? 0,
    score: change.score ?? before?.score ?? 0,
    repeat: change.repeat ?? before?.repeat ?? 0,
    updatedAt: Math.floor(now / 1000),
  };
  // AniList fills in the rest of a new entry: send only what changed, with the status a new one needs.
  enqueue(space, { kind: "set", mediaId, change: before ? change : { status: after.status, ...change } });
  keepEntry(space, after);
  void syncList();
  return after;
}

/** Takes the anime off the profile's list. */
export function removeEntry(space: string | null, mediaId: number) {
  enqueue(space, { kind: "remove", mediaId });
  keepEntry(space, null, mediaId);
  void syncList();
}

/** The link's state as the Settings row says it. */
export type LinkState = "none" | "linked" | "expired" | "refused";

export function linkState(link: Link | undefined, now: number): LinkState {
  if (!link) return "none";
  if (link.refused) return "refused";
  return link.expiresAt > now ? "linked" : "expired";
}

/** The link of `space`, for the code that reads it once. */
export const anilistLink = (space: string | null) => getLink("anilist", space);

/** AniList's names of the statuses, as its own site says them for anime. */
export const STATUS_NAMES: Record<ListStatus, string> = {
  CURRENT: "Watching",
  PLANNING: "Plan to watch",
  COMPLETED: "Completed",
  PAUSED: "Paused",
  DROPPED: "Dropped",
  REPEATING: "Rewatching",
};

/** The scores an account's format allows: 0 is "not scored". `labels` name each step where the format draws symbols. */
export interface ScoreScale {
  max: number;
  step: number;
  labels?: string[];
}

export function scoreScale(format: string): ScoreScale {
  switch (format) {
    case "POINT_100":
      return { max: 100, step: 1 };
    case "POINT_10_DECIMAL":
      return { max: 10, step: 0.1 };
    case "POINT_5":
      return { max: 5, step: 1, labels: ["★", "★★", "★★★", "★★★★", "★★★★★"] };
    case "POINT_3":
      return { max: 3, step: 1, labels: ["Disliked", "Neutral", "Liked"] };
    default:
      return { max: 10, step: 1 };
  }
}

/** A typed or picked score, fitted to the scale: in range, on a step; `null` when it isn't a number. */
export function fitScore(value: number, scale: ScoreScale): number | null {
  if (!Number.isFinite(value)) return null;
  const stepped = Math.round(Math.min(Math.max(value, 0), scale.max) / scale.step) * scale.step;
  return Math.round(stepped * 10) / 10;
}
