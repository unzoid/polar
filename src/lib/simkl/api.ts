import { isRecord, str } from "../parse";
import { concurrency, Limiter, PRIORITY, realClock, retryAfter, type Clock, type Priority } from "../net/limiter";
import { appVersion } from "../updater";

/**
 * Simkl's API (#86): every request a linked profile makes goes through {@link simkl}, with the
 * parameters Simkl asks for on every call (`client_id`, `app-name`, `app-version`) and within its
 * limits (api.simkl.org, "Rate limits"): 10 reads and 1 write a second, one request at a time per
 * token. Each Simkl user also has a daily allowance shared by every app they use (500 requests on
 * a free account), so Polarity reads only what moved (lib/simkl/pull.ts) and, once Simkl says the
 * allowance is nearly spent, leaves background work for the next day ({@link simklQuotaLow}).
 *
 * The token and the client id are never logged.
 */

export const SIMKL_API_URL = "https://api.simkl.com";

/**
 * The Simkl app Polarity signs in through, given to the build (`VITE_SIMKL_CLIENT_ID`) like the other
 * list services' ids. Simkl's public clients have no secret. Without one the sign-in says it isn't
 * set up in this build.
 */
export const SIMKL_CLIENT_ID = ((import.meta.env.VITE_SIMKL_CLIENT_ID as string | undefined) ?? "").trim();

/** Whether this build has a Simkl app to sign in through. */
export const simklReady = (clientId = SIMKL_CLIENT_ID) => /^[A-Za-z0-9_-]{16,128}$/.test(clientId);

export const APP_NAME = "polarity";

export const simklReads = new Limiter({ burst: 5, perMinute: 120, retries: 0, defaultWait: 1_000, maxWait: 60_000 });
export const simklWrites = new Limiter({ burst: 1, perMinute: 60, retries: 0, defaultWait: 1_000, maxWait: 60_000 });

/** One request at a time to Simkl, whatever it is (Simkl: "one in-flight request at a time per token"). */
const oneAtATime = concurrency(1);

/** The token was refused (run out or revoked): the profile signs in again. */
export class SimklSignedOut extends Error {
  constructor() {
    super("Simkl refused the sign-in");
    this.name = "SimklSignedOut";
  }
}

/**
 * Simkl answered with an error; `status` is the HTTP status and `code` Simkl's `error`.
 * A 429 with `user_limit_exceeded` is the account's daily allowance: nothing more goes until it resets.
 */
export class SimklError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SimklError";
  }
}

export interface SimklCaller {
  /** The profile's access token; none for the sign-in's own requests. */
  token?: string;
  clientId?: string;
  /** What `app-version` says; the app's own version when left out. */
  version?: string;
  fetch?: typeof fetch;
  clock?: Clock;
  priority?: Priority;
  signal?: AbortSignal;
  /** Tests: the budget requests take from instead of Simkl's read or write one. */
  limiter?: Limiter;
  /** Tests: where the daily allowance is kept instead of the shared one. */
  quota?: SimklQuota;
}

export type Method = "GET" | "POST";

/** One answer as it came: the status, the JSON body (`null` when empty or not JSON) and Simkl's `error` code. */
export interface SimklAnswer {
  status: number;
  body: unknown;
  code?: string;
}

/**
 * What Simkl said about the account's daily allowance: requests left (`X-RateLimit-Remaining`, when
 * Simkl sends it and the web view may read it) and, after a `user_limit_exceeded`, when it resets.
 */
export class SimklQuota {
  remaining: number | undefined;
  blockedUntil = 0;
}

export const simklQuota = new SimklQuota();

/** Background reads stop below this many requests left today, so the user's other apps keep theirs. */
export const QUOTA_RESERVE = 50;

/** Whether Simkl said the daily allowance is (nearly) spent: background work waits for the next day. */
export function simklQuotaLow(now = Date.now(), quota = simklQuota): boolean {
  return now < quota.blockedUntil || (quota.remaining !== undefined && quota.remaining < QUOTA_RESERVE);
}

let version: Promise<string> | undefined;
const versionOf = (caller: SimklCaller) => (caller.version ? Promise.resolve(caller.version) : (version ??= appVersion().catch(() => "dev")));

/** `path` with the parameters Simkl wants on every call, plus `query`. */
export function simklUrl(path: string, clientId: string, appVersion: string, query: Record<string, string> = {}): string {
  const url = new URL(`${SIMKL_API_URL}${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("app-name", APP_NAME);
  url.searchParams.set("app-version", appVersion);
  return url.toString();
}

/** A short wait before trying again after Simkl's per-second limit or its per-user write lock. */
const BRIEF_WAIT = 1_100;

/**
 * Sends a request and returns Simkl's answer whatever its status (the sign-in reads its own
 * statuses). `form` sends the body form-encoded, as the sign-in's own requests want; else JSON.
 * A per-second 429 or a write lock (`400 RATE_LIMIT`) is tried again once after a second; a spent
 * daily allowance answers 429 at once until it resets, without asking Simkl.
 */
export async function simklRaw(
  method: Method,
  path: string,
  body: unknown,
  caller: SimklCaller = {},
  { form = false, query }: { form?: boolean; query?: Record<string, string> } = {},
): Promise<SimklAnswer> {
  const clock = caller.clock ?? realClock;
  const quota = caller.quota ?? simklQuota;
  if (clock.now() < quota.blockedUntil) return { status: 429, body: null, code: "user_limit_exceeded" };
  const clientId = caller.clientId ?? SIMKL_CLIENT_ID;
  const url = simklUrl(path, clientId, await versionOf(caller), query);
  const headers: Record<string, string> = {};
  let payload: string | undefined;
  if (body !== undefined) {
    if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      payload = new URLSearchParams(body as Record<string, string>).toString();
    } else {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  if (caller.token) headers.Authorization = `Bearer ${caller.token}`;
  // The sign-in's own requests don't wait behind changes going out.
  const limiter = caller.limiter ?? (method === "GET" || path.startsWith("/oauth2/") ? simklReads : simklWrites);
  const doFetch = caller.fetch ?? fetch;
  for (let attempt = 0; ; attempt++) {
    await limiter.take(caller.signal, caller.priority ?? PRIORITY.background);
    const res = await oneAtATime(() => doFetch(url, { method, headers, body: payload, signal: caller.signal }));
    const remaining = Number(res.headers.get("X-RateLimit-Remaining") ?? NaN);
    if (Number.isFinite(remaining)) quota.remaining = remaining;
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: the status says what happened.
    }
    const code = isRecord(json) ? str(json.error) : undefined;
    if (res.status === 429 && code === "user_limit_exceeded") {
      // A duration, not a date; without one, wait an hour before asking again.
      quota.blockedUntil = clock.now() + Math.min(retryAfter(res.headers.get("Retry-After"), clock.now()) ?? 3_600_000, 86_400_000);
    }
    const brief = (res.status === 429 && code !== "user_limit_exceeded") || (res.status === 400 && code?.toUpperCase() === "RATE_LIMIT");
    if (brief && attempt === 0) {
      await clock.sleep(BRIEF_WAIT, caller.signal);
      continue;
    }
    return { status: res.status, body: json, code };
  }
}

/** Sends a signed-in request and returns its body; throws {@link SimklSignedOut} on 401, {@link SimklError} on any other failure. */
export async function simkl(method: Method, path: string, body: unknown, caller: SimklCaller, query?: Record<string, string>): Promise<unknown> {
  const answer = await simklRaw(method, path, body, caller, { query });
  if (answer.status === 401) throw new SimklSignedOut();
  if (answer.status >= 200 && answer.status < 300) return answer.body;
  const b = answer.body;
  const message = isRecord(b) ? (str(b.error_description) ?? str(b.message) ?? answer.code) : undefined;
  throw new SimklError(message || `Simkl answered ${answer.status}`, answer.status, answer.code);
}

/** A failure worth trying again later: no network, Simkl busy or down, or the day's allowance spent. */
export function simklOffline(e: unknown): boolean {
  if (e instanceof TypeError) return true; // fetch's network failure
  return e instanceof SimklError && (e.status === 429 || e.status >= 500 || e.code?.toUpperCase() === "RATE_LIMIT");
}
