import { isRecord, num, str } from "../parse";
import { simkl, SIMKL_CLIENT_ID, simklRaw, SimklError, SimklSignedOut, type SimklCaller } from "./api";
import type { SimklLink } from "./link";

/**
 * Signing a profile in to Simkl (#86) with Simkl's device flow (OAuth 2.0, Auth V2): Polarity asks
 * for a short code, shows it with the address to enter it at (simkl.com/pin), and the user allows
 * Polarity there, from any browser or phone. Meanwhile Polarity asks every few seconds whether the
 * code was allowed. No redirect comes back to the app, so the flow is the same on desktop, phones
 * and the TV layout.
 *
 * Simkl's public clients have no secret, so only the client id is sent. Access tokens last 7 days
 * and are refreshed before they run out; the refresh token stays the same and lasts 180 days from
 * its last use. Simkl never answers "declined": a code nobody allows just runs out (15 minutes).
 */

export interface DeviceCode {
  /** What Polarity polls with; never shown. */
  deviceCode: string;
  /** What the user types at {@link verificationUrl}. */
  userCode: string;
  verificationUrl: string;
  /** The same page with the code filled in, when Simkl gave one; what "Open Simkl" opens. */
  completeUrl?: string;
  /** When the code stops working, in ms since the epoch. */
  expiresAt: number;
  /** How long to wait between two polls, in ms. */
  interval: number;
}

/** What Polarity asks for: reading and changing the account's lists. Without `media:write` Simkl quietly gives read-only. */
export const SIMKL_SCOPE = "media:read media:write";

const clientOf = (caller: Pick<SimklCaller, "clientId">) => caller.clientId ?? SIMKL_CLIENT_ID;

/** Only Simkl's own pages are opened or shown as the place to enter the code. */
const SIMKL_PAGE = /^https:\/\/(?:www\.)?simkl\.com\/[A-Za-z0-9/_-]*(?:\?user_code=[A-Za-z0-9-]{4,16})?$/;
const DEFAULT_PAGE = "https://simkl.com/pin";

export function readDeviceCode(v: unknown, now: number): DeviceCode | undefined {
  if (!isRecord(v)) return undefined;
  const [deviceCode, userCode] = [str(v.device_code), str(v.user_code)];
  if (!deviceCode || !userCode || !/^[A-Za-z0-9-]{4,16}$/.test(userCode)) return undefined;
  const url = str(v.verification_uri) ?? "";
  const complete = str(v.verification_uri_complete) ?? "";
  // Simkl's codes last 15 minutes; whatever the answer says, the wait stops within half an hour.
  const expiresIn = Math.min(Math.max(num(v.expires_in) ?? 900, 1), 1800);
  // At least 5 s apart (Simkl's interval) and no slower than every 30 s, whatever the answer said.
  const interval = Math.min(Math.max(num(v.interval) ?? 5, 5), 30) * 1000;
  const code: DeviceCode = {
    deviceCode,
    userCode,
    verificationUrl: SIMKL_PAGE.test(url) && !url.includes("?") ? url : DEFAULT_PAGE,
    expiresAt: now + expiresIn * 1000,
    interval,
  };
  if (SIMKL_PAGE.test(complete) && complete.endsWith(`?user_code=${userCode}`)) code.completeUrl = complete;
  return code;
}

/** Asks Simkl for a new code to show. */
export async function startDeviceSignIn(caller: SimklCaller & { now?: number } = {}): Promise<DeviceCode> {
  const answer = await simklRaw("POST", "/oauth2/device", { client_id: clientOf(caller), scope: SIMKL_SCOPE }, { ...caller, token: undefined }, { form: true });
  const code = answer.status >= 200 && answer.status < 300 ? readDeviceCode(answer.body, caller.now ?? Date.now()) : undefined;
  if (!code) throw new SimklError("Simkl didn't give a code", answer.status, answer.code);
  return code;
}

export interface SimklTokens {
  token: string;
  refreshToken: string;
  expiresAt: number;
  /** Simkl gave write access: what Polarity asked for. */
  canWrite: boolean;
}

/** A token as it goes into a header: printable, no spaces, at most 4096 characters. */
const TOKEN = /^[\x21-\x7e]{1,4096}$/;

export function readTokens(v: unknown, now: number, refreshToken?: string): SimklTokens | undefined {
  if (!isRecord(v)) return undefined;
  const token = str(v.access_token);
  // A refresh answer repeats the refresh token; one that leaves it out keeps the one sent.
  const refresh = str(v.refresh_token) ?? refreshToken;
  if (!token || !refresh || !TOKEN.test(token) || !TOKEN.test(refresh)) return undefined;
  // Our clock decides when to refresh, so the life counts from now (a minute to a year).
  const life = Math.min(Math.max(num(v.expires_in) ?? 7 * 24 * 60 * 60, 60), 365 * 24 * 60 * 60);
  const scopes = (str(v.scope) ?? "").split(/\s+/);
  return { token, refreshToken: refresh, expiresAt: now + life * 1000, canWrite: scopes.includes("media:write") };
}

/**
 * Where a poll leaves the sign-in: allowed (with the tokens), still waiting (`slower`: Simkl asked
 * for longer waits), or over: the code ran out, or Simkl refused this build's client id.
 */
export type PollResult = { state: "allowed"; tokens: SimklTokens } | { state: "waiting"; slower?: boolean } | { state: "expired" | "invalid" };

/** One poll: has the user allowed `code` yet? Network failures throw, and the caller polls again. */
export async function pollDeviceSignIn(code: DeviceCode, caller: SimklCaller & { now?: number } = {}): Promise<PollResult> {
  const now = caller.now ?? Date.now();
  if (now >= code.expiresAt) return { state: "expired" };
  const answer = await simklRaw(
    "POST",
    "/oauth2/token",
    { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientOf(caller), device_code: code.deviceCode },
    { ...caller, token: undefined },
    { form: true },
  );
  if (answer.status === 200) {
    const tokens = readTokens(answer.body, now);
    return tokens ? { state: "allowed", tokens } : { state: "invalid" };
  }
  switch (answer.code) {
    case "authorization_pending":
      return { state: "waiting" };
    case "slow_down":
      return { state: "waiting", slower: true };
    case "expired_token":
      return { state: "expired" };
  }
  if (answer.status === 429 && answer.code !== "user_limit_exceeded") return { state: "waiting", slower: true };
  if (answer.status >= 500) return { state: "waiting" };
  return { state: "invalid" };
}

/**
 * Polls until the user allows `code` or it runs out. Stops when `signal` aborts (the user closed
 * the sign-in).
 */
export async function waitForDeviceSignIn(
  code: DeviceCode,
  {
    signal,
    sleep = (ms, s) =>
      new Promise((go, stop) => {
        const t = setTimeout(go, ms);
        s?.addEventListener("abort", () => (clearTimeout(t), stop(s.reason)), { once: true });
      }),
    now = Date.now,
    ...caller
  }: Omit<SimklCaller, "token"> & { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number } = {},
): Promise<Exclude<PollResult, { state: "waiting" }>> {
  let interval = code.interval;
  for (;;) {
    await sleep(interval, signal);
    if (signal?.aborted) throw signal.reason;
    let result: PollResult;
    try {
      result = await pollDeviceSignIn(code, { ...caller, signal, now: now() });
    } catch (e) {
      if (signal?.aborted) throw e;
      // Not reached this time: the next poll tries again until the code runs out.
      if (now() >= code.expiresAt) return { state: "expired" };
      continue;
    }
    if (result.state !== "waiting") return result;
    // Simkl: add 5 s on slow_down.
    if (result.slower) interval = Math.min(interval + 5000, 60_000);
  }
}

/** Who signed in: the account's number and name, from Simkl's settings for the user. */
export async function simklViewer(caller: SimklCaller): Promise<{ account: number; name: string }> {
  const body = await simkl("GET", "/users/settings", undefined, caller);
  const user = isRecord(body) && isRecord(body.user) ? body.user : {};
  const account = isRecord(body) && isRecord(body.account) ? num(body.account.id) : undefined;
  if (account === undefined) throw new SimklError("Simkl didn't say who signed in", 0);
  return { account, name: str(user.name)?.trim() || `Simkl ${account}` };
}

/** A new access token for `link`; Simkl refusing the refresh token signs the profile out. */
export async function refreshSimkl(link: SimklLink, caller: Omit<SimklCaller, "token"> & { now?: number } = {}): Promise<SimklLink> {
  const answer = await simklRaw(
    "POST",
    "/oauth2/token",
    { grant_type: "refresh_token", client_id: clientOf(caller), refresh_token: link.refreshToken },
    caller,
    { form: true },
  );
  if (answer.status === 400 || answer.status === 401) {
    // A spent day or Simkl's write lock isn't a refusal.
    if (answer.code?.toUpperCase() === "RATE_LIMIT") throw new SimklError("Simkl is busy", answer.status, answer.code);
    throw new SimklSignedOut();
  }
  if (answer.status < 200 || answer.status >= 300) throw new SimklError(`Simkl answered ${answer.status}`, answer.status, answer.code);
  const tokens = readTokens(answer.body, caller.now ?? Date.now(), link.refreshToken);
  if (!tokens) throw new SimklSignedOut();
  const { canWrite: _, ...fresh } = tokens;
  return { ...link, ...fresh };
}

/** Tells Simkl the sign-in is no longer used (unlinking). Failing to reach Simkl doesn't stop the unlink. */
export async function revokeSimkl(refreshToken: string, caller: Omit<SimklCaller, "token"> = {}): Promise<void> {
  await simklRaw("POST", "/oauth2/revoke", { client_id: clientOf(caller), token: refreshToken }, caller, { form: true }).catch(() => undefined);
}
