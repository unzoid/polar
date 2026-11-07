import { isRecord, str } from "../parse";
import { limitedFetch, Limiter, PRIORITY, realClock, type Clock, type Priority } from "../net/limiter";

/**
 * Trakt's API (#85): every request a linked profile makes goes through {@link trakt}, with the
 * headers Trakt asks for and within its limits (developer.trakt.tv, "Rate limiting"): 500 reads
 * per 5 minutes per signed-in user, of which Polarity uses at most 90 a minute, and 1 write a second.
 * A 429 waits for its Retry-After once, then goes back to the caller as a {@link TraktError}.
 *
 * Trakt answers the web view's own requests (CORS open to every origin), so nothing goes through
 * the native side. The token and the client id are never logged.
 */

export const TRAKT_API_URL = "https://api.trakt.tv";

/**
 * The Trakt API app Polarity signs in through, given to the build (`VITE_TRAKT_CLIENT_ID`)
 * rather than kept in the source. Without one the sign-in says it isn't set up in this build.
 */
export const TRAKT_CLIENT_ID = ((import.meta.env.VITE_TRAKT_CLIENT_ID as string | undefined) ?? "").trim();

/** Whether this build has a Trakt app to sign in through (Trakt's client ids are 64 hex digits). */
export const traktReady = (clientId = TRAKT_CLIENT_ID) => /^[0-9a-f]{64}$/i.test(clientId);

export const traktReads = new Limiter({ burst: 20, perMinute: 90, retries: 1, defaultWait: 30_000, maxWait: 5 * 60_000 });
export const traktWrites = new Limiter({ burst: 1, perMinute: 60, retries: 1, defaultWait: 2_000, maxWait: 60_000 });

/** The token was refused (run out or revoked): the profile signs in again. */
export class TraktSignedOut extends Error {
  constructor() {
    super("Trakt refused the sign-in");
    this.name = "TraktSignedOut";
  }
}

/**
 * Trakt answered with an error; `status` is the HTTP status. 420 is an account limit (a free
 * account's watchlist or lists are full), 429 a rate limit still in force after one wait.
 */
export class TraktError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TraktError";
  }
}

export interface TraktCaller {
  /** The profile's access token; none for the sign-in's own requests. */
  token?: string;
  clientId?: string;
  fetch?: typeof fetch;
  clock?: Clock;
  priority?: Priority;
  signal?: AbortSignal;
  /** Tests: the budget requests take from instead of Trakt's read or write one. */
  limiter?: Limiter;
}

export type Method = "GET" | "POST" | "DELETE";

/** One answer as it came: the status, the JSON body (`null` when empty or not JSON) and the headers Polarity reads. */
export interface TraktAnswer {
  status: number;
  body: unknown;
  headers: Headers;
}

/** Sends a request and returns Trakt's answer whatever its status (the sign-in reads its own statuses). */
export async function traktRaw(method: Method, path: string, body: unknown, caller: TraktCaller = {}): Promise<TraktAnswer> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": caller.clientId ?? TRAKT_CLIENT_ID,
  };
  if (caller.token) headers.Authorization = `Bearer ${caller.token}`;
  const res = await limitedFetch(
    // The sign-in's own requests don't wait behind changes going out.
    caller.limiter ?? (method === "GET" || path.startsWith("/oauth/") ? traktReads : traktWrites),
    `${TRAKT_API_URL}${path}`,
    { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: caller.signal },
    { fetch: caller.fetch, clock: caller.clock ?? realClock, priority: caller.priority ?? PRIORITY.background },
  );
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: the status says what happened.
  }
  return { status: res.status, body: json, headers: res.headers };
}

/** Sends a signed-in request and returns its body; throws {@link TraktSignedOut} on 401, {@link TraktError} on any other failure. */
export async function trakt(method: Method, path: string, body: unknown, caller: TraktCaller): Promise<unknown> {
  const answer = await traktRaw(method, path, body, caller);
  if (answer.status === 401) throw new TraktSignedOut();
  if (answer.status >= 200 && answer.status < 300) return answer.body;
  const b = answer.body;
  const message = isRecord(b) ? (str(b.error_description) ?? str(b.error) ?? str(b.message)) : undefined;
  throw new TraktError(message || `Trakt answered ${answer.status}`, answer.status);
}

/** A failure worth trying again later: no network, or Trakt still busy after its wait. */
export function traktOffline(e: unknown): boolean {
  if (e instanceof TypeError) return true; // fetch's network failure
  return e instanceof TraktError && (e.status === 429 || e.status >= 500);
}
