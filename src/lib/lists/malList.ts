import { isRecord, listOf, num, str } from "../parse";
import { call } from "../platform/bridge";
import { ListError, SignedOut, type Caller, type EntryChange, type ListEntry, type ListStatus, type Relay, type RelayRequest, type Viewer } from "./entry";

/**
 * A signed-in profile's MyAnimeList list (#84), through MAL's API v2: who is signed in, one entry,
 * the whole list, what changed lately, and saving or removing an entry. MAL doesn't answer the web
 * view's own requests, so they go through the native relay (src-tauri/src/mal.rs), which lets only
 * these paths through.
 *
 * MAL keys an entry by the anime: an entry's `id` is its anime's. Scores are 0–10, whole numbers.
 * A rewatch is a finished entry with `is_rewatching` set; Polarity calls it `REPEATING`.
 *
 * As with AniList, the list stays on the device and is never copied into Polarity's sync.
 */

const nativeRelay: Relay = (req) => call("mal_api", { ...req });

const STATUS_OUT: Record<ListStatus, string> = {
  CURRENT: "watching",
  PLANNING: "plan_to_watch",
  COMPLETED: "completed",
  PAUSED: "on_hold",
  DROPPED: "dropped",
  REPEATING: "completed",
};

const STATUS_IN: Record<string, ListStatus> = {
  watching: "CURRENT",
  plan_to_watch: "PLANNING",
  completed: "COMPLETED",
  on_hold: "PAUSED",
  dropped: "DROPPED",
};

/** The fields an entry is read with, its anime's too when the import needs them. */
const STATUS_FIELDS = "status,score,num_episodes_watched,is_rewatching,num_times_rewatched,updated_at";
const LIST_FIELDS = `list_status{${STATUS_FIELDS}}`;
const IMPORT_FIELDS = `${LIST_FIELDS},num_episodes,media_type,nsfw,alternative_titles,main_picture`;

async function ask(req: Omit<RelayRequest, "token" | "query" | "form"> & Partial<RelayRequest>, { token, relay, signal }: Caller): Promise<unknown> {
  let answer: { status: number; body: string };
  try {
    answer = await (relay ?? nativeRelay)({ query: [], form: [], ...req, token });
  } catch {
    // The relay couldn't reach MAL: the same as fetch's network failure, tried again later.
    throw new TypeError("MyAnimeList can't be reached");
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const { status, body } = answer;
  if (status === 401) throw new SignedOut("MyAnimeList");
  let json: unknown = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    // Not JSON: the status says what happened.
  }
  if (status >= 200 && status < 300) return json;
  const message = isRecord(json) ? (str(json.message) ?? str(json.error)) : undefined;
  // MAL's only rate limit answer is 403 "DoS detected": a busy service, tried again later like a 429.
  throw new ListError(message || `MyAnimeList answered ${status}`, status === 403 ? 429 : status);
}

/** A `my_list_status` (or a list item's `list_status`) of anime `animeId` as an entry. */
export function readMalStatus(v: unknown, animeId: number): ListEntry | undefined {
  if (!isRecord(v)) return undefined;
  const status = STATUS_IN[str(v.status) ?? ""];
  if (!status || !Number.isSafeInteger(animeId) || animeId <= 0) return undefined;
  const updated = Date.parse(str(v.updated_at) ?? "");
  return {
    id: animeId,
    mediaId: animeId,
    status: v.is_rewatching === true ? "REPEATING" : status,
    progress: num(v.num_episodes_watched) ?? 0,
    score: num(v.score) ?? 0,
    repeat: num(v.num_times_rewatched) ?? 0,
    updatedAt: Number.isFinite(updated) ? Math.floor(updated / 1000) : 0,
  };
}

/** One item of the list (`{ node, list_status }`), with what the import needs of its anime. */
export function readMalItem(v: unknown): ListEntry | undefined {
  if (!isRecord(v) || !isRecord(v.node)) return undefined;
  const { node } = v;
  const entry = readMalStatus(v.list_status, num(node.id) ?? 0);
  if (!entry) return undefined;
  const alt = isRecord(node.alternative_titles) ? node.alternative_titles : {};
  const picture = isRecord(node.main_picture) ? node.main_picture : {};
  const type = str(node.media_type);
  entry.episodes = num(node.num_episodes) || null;
  entry.isAdult = node.nsfw === "black";
  if (type) entry.format = type.toUpperCase();
  entry.title = str(alt.en) || str(node.title) || undefined;
  entry.poster = str(picture.large) || str(picture.medium) || undefined;
  return entry;
}

export async function malViewer(caller: Caller): Promise<Viewer> {
  const me = await ask({ method: "GET", path: "users/@me" }, caller);
  const id = isRecord(me) ? num(me.id) : undefined;
  if (!isRecord(me) || id === undefined) throw new Error("MyAnimeList didn't say who is signed in");
  // MAL's scores are always out of 10, and its API doesn't say whether the account shows adult entries.
  return { id, name: str(me.name) ?? "", scoreFormat: "POINT_10", adult: false };
}

/** The signed-in account's entry for anime `animeId`, or `null` when it isn't on the list. */
export async function malEntryFor(_userId: number, animeId: number, caller: Caller): Promise<ListEntry | null> {
  try {
    const anime = await ask({ method: "GET", path: `anime/${animeId}`, query: [["fields", "my_list_status"]] }, caller);
    return (isRecord(anime) && readMalStatus(anime.my_list_status, animeId)) || null;
  } catch (e) {
    if (e instanceof ListError && e.status === 404) return null;
    throw e;
  }
}

/** The form MAL takes for `change`: only what changed. */
export function malForm(change: EntryChange): [string, string][] {
  const form: [string, string][] = [];
  if (change.status) form.push(["status", STATUS_OUT[change.status]], ["is_rewatching", String(change.status === "REPEATING")]);
  if (change.progress !== undefined) form.push(["num_watched_episodes", String(Math.max(0, Math.round(change.progress)))]);
  if (change.score !== undefined) form.push(["score", String(Math.min(10, Math.max(0, Math.round(change.score))))]);
  if (change.repeat !== undefined) form.push(["num_times_rewatched", String(Math.max(0, Math.round(change.repeat)))]);
  return form;
}

/** Creates or changes the account's entry for `animeId`; MAL's answer is the entry as saved. */
export async function malSaveEntry(animeId: number, change: EntryChange, caller: Caller): Promise<ListEntry> {
  const saved = readMalStatus(await ask({ method: "PATCH", path: `anime/${animeId}/my_list_status`, form: malForm(change) }, caller), animeId);
  if (!saved) throw new Error("MyAnimeList didn't return the saved entry");
  return saved;
}

/** Takes anime `animeId` off the list; already gone (404, a retry after a lost answer) is done too. */
export async function malDeleteEntry(animeId: number, caller: Caller): Promise<void> {
  try {
    await ask({ method: "DELETE", path: `anime/${animeId}/my_list_status` }, caller);
  } catch (e) {
    if (!(e instanceof ListError && e.status === 404)) throw e;
  }
}

const PAGE = 1000;

/** The account's whole anime list, a thousand entries a request, adult ones too, for the import. */
export async function malWholeList(_userId: number, caller: Caller): Promise<ListEntry[]> {
  const all: ListEntry[] = [];
  for (let page = 0; page < 40; page++) {
    const query: [string, string][] = [
      ["fields", IMPORT_FIELDS],
      ["limit", String(PAGE)],
      ["offset", String(page * PAGE)],
      ["nsfw", "true"],
    ];
    const list = await ask({ method: "GET", path: "users/@me/animelist", query }, caller);
    if (!isRecord(list)) break;
    all.push(...listOf(list.data, readMalItem));
    const paging = isRecord(list.paging) ? list.paging : {};
    if (!str(paging.next)) break;
  }
  return [...new Map(all.map((e) => [e.id, e])).values()];
}

/** Entries changed on MAL after `since` (seconds), newest first, up to 50. */
export async function malChangedSince(_userId: number, since: number, caller: Caller): Promise<ListEntry[]> {
  const query: [string, string][] = [
    ["fields", LIST_FIELDS],
    ["sort", "list_updated_at"],
    ["limit", "50"],
    ["nsfw", "true"],
  ];
  const list = await ask({ method: "GET", path: "users/@me/animelist", query }, caller);
  return listOf(isRecord(list) ? list.data : [], readMalItem).filter((e) => e.updatedAt > since);
}
