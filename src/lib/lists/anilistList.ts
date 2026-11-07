import { anilistLimiter, limitedFetch, PRIORITY, type Priority } from "../net/limiter";
import { isRecord, listOf, num, str } from "../parse";

/**
 * A signed-in profile's AniList list (#83): who is signed in, one entry, the whole list, what
 * changed lately, and saving or removing an entry. Through the same budget as the catalogue's
 * requests (lib/net/limiter.ts), so list reads and writes never push AniList past its limit.
 *
 * The list is only read to show it and to import it into the library: it stays on the device
 * and is never copied into Polarity's sync.
 */
const ENDPOINT = "https://graphql.anilist.co";

export type ListStatus = "CURRENT" | "PLANNING" | "COMPLETED" | "DROPPED" | "PAUSED" | "REPEATING";
export const LIST_STATUSES: readonly ListStatus[] = ["CURRENT", "PLANNING", "COMPLETED", "PAUSED", "DROPPED", "REPEATING"];

export interface ListEntry {
  /** The list entry's own id (for removing it). */
  id: number;
  /** The AniList entry (media) it is about. */
  mediaId: number;
  status: ListStatus;
  /** Episodes watched. */
  progress: number;
  /** In the account's score format; 0 = not scored. */
  score: number;
  /** Times watched again to the end. */
  repeat: number;
  /** When it last changed on AniList, in seconds since the epoch. */
  updatedAt: number;
  /** What the import needs of the entry, when the read asked for it. */
  episodes?: number | null;
  isAdult?: boolean;
  /** AniList's format (`TV`, `MOVIE`, `OVA`…), title and cover; when it was added, in seconds. */
  format?: string;
  title?: string;
  poster?: string;
  createdAt?: number;
}

export interface Viewer {
  id: number;
  name: string;
  scoreFormat: string;
  adult: boolean;
}

/** The token was refused (run out or revoked): the profile signs in again. */
export class SignedOut extends Error {
  constructor() {
    super("AniList refused the sign-in");
    this.name = "SignedOut";
  }
}

/** AniList answered with an error; `status` is the HTTP status. */
export class ListError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ListError";
  }
}

export interface Caller {
  token: string;
  fetch?: typeof fetch;
  priority?: Priority;
  signal?: AbortSignal;
}

async function ask(query: string, variables: Record<string, unknown>, { token, fetch: doFetch, priority, signal }: Caller) {
  const res = await limitedFetch(
    anilistLimiter,
    ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
      signal,
    },
    { priority: priority ?? PRIORITY.visible, fetch: doFetch },
  );
  if (res.status === 401) throw new SignedOut();
  const json: unknown = await res.json().catch(() => null);
  const errors = isRecord(json) && Array.isArray(json.errors) ? json.errors : [];
  // AniList answers an invalid token with 400 and "Invalid token".
  if (errors.some((e) => isRecord(e) && (e.status === 401 || /invalid token/i.test(str(e.message) ?? "")))) throw new SignedOut();
  const data = isRecord(json) && isRecord(json.data) ? json.data : undefined;
  if (!res.ok || !data) {
    const message = isRecord(errors[0]) ? str(errors[0].message) : undefined;
    throw new ListError(message ?? `AniList answered ${res.status}`, res.status);
  }
  return data;
}

const ENTRY_FIELDS = "id mediaId status progress score repeat updatedAt";

const isStatus = (v: unknown): v is ListStatus => typeof v === "string" && (LIST_STATUSES as readonly string[]).includes(v);

export function readEntry(v: unknown): ListEntry | undefined {
  if (!isRecord(v)) return undefined;
  const id = num(v.id);
  const mediaId = num(v.mediaId);
  if (id === undefined || mediaId === undefined || !isStatus(v.status)) return undefined;
  const entry: ListEntry = {
    id,
    mediaId,
    status: v.status,
    progress: num(v.progress) ?? 0,
    score: num(v.score) ?? 0,
    repeat: num(v.repeat) ?? 0,
    updatedAt: num(v.updatedAt) ?? 0,
  };
  if (isRecord(v.media)) {
    const { media } = v;
    const title = isRecord(media.title) ? media.title : {};
    const cover = isRecord(media.coverImage) ? media.coverImage : {};
    entry.episodes = num(media.episodes) ?? null;
    entry.isAdult = media.isAdult === true;
    entry.format = str(media.format);
    entry.title = str(title.english) || str(title.romaji) || str(title.native) || undefined;
    entry.poster = str(cover.extraLarge) || str(cover.large) || undefined;
  }
  const created = num(v.createdAt);
  if (created) entry.createdAt = created;
  return entry;
}

export async function viewer(caller: Caller): Promise<Viewer> {
  const data = await ask("query { Viewer { id name mediaListOptions { scoreFormat } options { displayAdultContent } } }", {}, caller);
  const v = isRecord(data.Viewer) ? data.Viewer : undefined;
  const id = num(v?.id);
  if (!v || id === undefined) throw new Error("AniList didn't say who is signed in");
  const options = isRecord(v.mediaListOptions) ? v.mediaListOptions : {};
  const prefs = isRecord(v.options) ? v.options : {};
  return { id, name: str(v.name) ?? "", scoreFormat: str(options.scoreFormat) ?? "POINT_10", adult: prefs.displayAdultContent === true };
}

/** The signed-in account's entry for `mediaId`, or `null` when it isn't on the list. */
export async function entryFor(userId: number, mediaId: number, caller: Caller): Promise<ListEntry | null> {
  const data = await ask(
    `query ($u: Int, $m: Int) { Page(perPage: 1) { mediaList(userId: $u, mediaId: $m) { ${ENTRY_FIELDS} } } }`,
    { u: userId, m: mediaId },
    caller,
  );
  const page = isRecord(data.Page) ? data.Page : {};
  return listOf(page.mediaList, readEntry)[0] ?? null;
}

export interface EntryChange {
  status?: ListStatus;
  progress?: number;
  score?: number;
  repeat?: number;
}

/** Creates or changes the account's entry for `mediaId`; AniList's answer is the entry as saved. */
export async function saveEntry(mediaId: number, change: EntryChange, caller: Caller): Promise<ListEntry> {
  const data = await ask(
    `mutation ($m: Int, $s: MediaListStatus, $p: Int, $sc: Float, $r: Int) {
      SaveMediaListEntry(mediaId: $m, status: $s, progress: $p, score: $sc, repeat: $r) { ${ENTRY_FIELDS} } }`,
    { m: mediaId, s: change.status, p: change.progress, sc: change.score, r: change.repeat },
    caller,
  );
  const saved = readEntry(data.SaveMediaListEntry);
  if (!saved) throw new Error("AniList didn't return the saved entry");
  return saved;
}

export async function deleteEntry(entryId: number, caller: Caller): Promise<void> {
  await ask("mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }", { id: entryId }, caller);
}

/** The account's whole anime list, 500 entries a request, for the import. */
export async function wholeList(userId: number, caller: Caller): Promise<ListEntry[]> {
  const all: ListEntry[] = [];
  for (let chunk = 1; chunk <= 40; chunk++) {
    const data = await ask(
      `query ($u: Int, $c: Int) { MediaListCollection(userId: $u, type: ANIME, chunk: $c, perChunk: 500) {
        hasNextChunk lists { entries { ${ENTRY_FIELDS} createdAt
          media { episodes isAdult format title { english romaji native } coverImage { extraLarge large } } } } } }`,
      { u: userId, c: chunk },
      { ...caller, priority: caller.priority ?? PRIORITY.near },
    );
    const collection = isRecord(data.MediaListCollection) ? data.MediaListCollection : {};
    for (const list of Array.isArray(collection.lists) ? collection.lists : []) {
      if (isRecord(list)) all.push(...listOf(list.entries, readEntry));
    }
    if (collection.hasNextChunk !== true) break;
  }
  // An entry in a custom list is also in its status list: once each.
  return [...new Map(all.map((e) => [e.id, e])).values()];
}

/** Entries changed on AniList after `since` (seconds), newest first, up to 50. */
export async function changedSince(userId: number, since: number, caller: Caller): Promise<ListEntry[]> {
  const data = await ask(
    `query ($u: Int) { Page(perPage: 50) { mediaList(userId: $u, type: ANIME, sort: UPDATED_TIME_DESC) { ${ENTRY_FIELDS} } } }`,
    { u: userId },
    { ...caller, priority: caller.priority ?? PRIORITY.background },
  );
  const page = isRecord(data.Page) ? data.Page : {};
  return listOf(page.mediaList, readEntry).filter((e) => e.updatedAt > since);
}
