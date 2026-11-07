import type { Priority } from "../net/limiter";

/**
 * What every linked list service (#83 AniList, #84 MyAnimeList) is read and changed as. Statuses are
 * Polarity's own, named as AniList names them; each service's client turns them into its own.
 */
export type ListStatus = "CURRENT" | "PLANNING" | "COMPLETED" | "DROPPED" | "PAUSED" | "REPEATING";
export const LIST_STATUSES: readonly ListStatus[] = ["CURRENT", "PLANNING", "COMPLETED", "PAUSED", "DROPPED", "REPEATING"];

export interface ListEntry {
  /** The list entry's own id, for removing it (MyAnimeList has none: the anime's id). */
  id: number;
  /** The anime it is about, by the service's own id (AniList's media id, MyAnimeList's anime id). */
  mediaId: number;
  status: ListStatus;
  /** Episodes watched. */
  progress: number;
  /** In the account's score format; 0 = not scored. */
  score: number;
  /** Times watched again to the end. */
  repeat: number;
  /** When it last changed on the service, in seconds since the epoch. */
  updatedAt: number;
  /** What the import needs of the entry, when the read asked for it. */
  episodes?: number | null;
  isAdult?: boolean;
  /** Its format as AniList names them (`TV`, `MOVIE`, `OVA`…), title and cover; when it was added, in seconds. */
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
  constructor(service = "AniList") {
    super(`${service} refused the sign-in`);
    this.name = "SignedOut";
  }
}

/** The service answered with an error; `status` is the HTTP status. */
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
  /** Tests: what MyAnimeList's requests go through instead of the native relay (malList.ts). */
  relay?: Relay;
}

/** A request to MyAnimeList through src-tauri/src/mal.rs, and its answer as it came. */
export interface RelayRequest {
  method: "GET" | "PATCH" | "DELETE";
  path: string;
  query: [string, string][];
  form: [string, string][];
  token: string;
}
export type Relay = (req: RelayRequest) => Promise<{ status: number; body: string }>;

export interface EntryChange {
  status?: ListStatus;
  progress?: number;
  score?: number;
  repeat?: number;
}

export const isStatus = (v: unknown): v is ListStatus => typeof v === "string" && (LIST_STATUSES as readonly string[]).includes(v);
