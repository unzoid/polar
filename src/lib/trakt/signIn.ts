import { isRecord, num, str } from "../parse";
import { trakt, TRAKT_CLIENT_ID, traktRaw, TraktError, TraktSignedOut, type TraktCaller } from "./api";
import type { TraktLink } from "./link";

/**
 * Signing a profile in to Trakt (#85) with Trakt's device code flow: Polarity asks for a short
 * code, shows it with the address to enter it at (trakt.tv/activate), and the user allows
 * Polarity there, from any browser or phone. Meanwhile Polarity asks every few seconds whether
 * the code was allowed. No redirect comes back to the app, so the flow is the same on desktop,
 * phones and the TV layout.
 *
 * Only the client id is sent, never a client secret: Polarity has no server to keep one.
 * Access tokens last 7 days and are refreshed before they run out; each refresh token works once.
 */

export interface DeviceCode {
  /** What Polarity polls with; never shown. */
  deviceCode: string;
  /** What the user types at {@link verificationUrl}. */
  userCode: string;
  verificationUrl: string;
  /** When the code stops working, in ms since the epoch. */
  expiresAt: number;
  /** How long to wait between two polls, in ms. */
  interval: number;
}

const clientOf = (caller: Pick<TraktCaller, "clientId">) => caller.clientId ?? TRAKT_CLIENT_ID;

/** Only Trakt's own addresses are opened or shown as the place to enter the code. */
const TRAKT_PAGE = /^https:\/\/(?:www\.)?trakt\.tv\/[A-Za-z0-9/_-]*$/;
const DEFAULT_PAGE = "https://trakt.tv/activate";

export function readDeviceCode(v: unknown, now: number): DeviceCode | undefined {
  if (!isRecord(v)) return undefined;
  const [deviceCode, userCode] = [str(v.device_code), str(v.user_code)];
  if (!deviceCode || !userCode || !/^[A-Za-z0-9-]{4,16}$/.test(userCode)) return undefined;
  const url = str(v.verification_url) ?? "";
  // Trakt's codes last 10 minutes; whatever the answer says, the wait stops within half an hour.
  const expiresIn = Math.min(Math.max(num(v.expires_in) ?? 600, 1), 1800);
  // At least 1 s apart and no slower than every 30 s, whatever the answer said.
  const interval = Math.min(Math.max(num(v.interval) ?? 5, 1), 30) * 1000;
  return { deviceCode, userCode, verificationUrl: TRAKT_PAGE.test(url) ? url : DEFAULT_PAGE, expiresAt: now + expiresIn * 1000, interval };
}

/** Asks Trakt for a new code to show. */
export async function startDeviceSignIn(caller: TraktCaller & { now?: number } = {}): Promise<DeviceCode> {
  const body = await trakt("POST", "/oauth/device/code", { client_id: clientOf(caller) }, { ...caller, token: undefined });
  const code = readDeviceCode(body, caller.now ?? Date.now());
  if (!code) throw new TraktError("Trakt didn't give a code", 0);
  return code;
}

export interface TraktTokens {
  token: string;
  refreshToken: string;
  expiresAt: number;
}

/** A token as it goes into a header: printable, no spaces, at most 4096 characters. */
const TOKEN = /^[\x21-\x7e]{1,4096}$/;

export function readTokens(v: unknown, now: number): TraktTokens | undefined {
  if (!isRecord(v)) return undefined;
  const [token, refreshToken] = [str(v.access_token), str(v.refresh_token)];
  if (!token || !refreshToken || !TOKEN.test(token) || !TOKEN.test(refreshToken)) return undefined;
  // `created_at` is Trakt's clock; ours decides when to refresh, so the life counts from now (a minute to a year).
  const life = Math.min(Math.max(num(v.expires_in) ?? 7 * 24 * 60 * 60, 60), 365 * 24 * 60 * 60);
  return { token, refreshToken, expiresAt: now + life * 1000 };
}

/**
 * Where a poll leaves the sign-in: allowed (with the tokens), still waiting (`slower`: Trakt asked
 * for longer waits), or over, as Trakt said why.
 */
export type PollResult =
  | { state: "allowed"; tokens: TraktTokens }
  | { state: "waiting"; slower?: boolean }
  | { state: "denied" | "expired" | "used" | "invalid" };

/** One poll: has the user allowed `code` yet? Network failures throw, and the caller polls again. */
export async function pollDeviceSignIn(code: DeviceCode, caller: TraktCaller & { now?: number } = {}): Promise<PollResult> {
  const now = caller.now ?? Date.now();
  if (now >= code.expiresAt) return { state: "expired" };
  const answer = await traktRaw("POST", "/oauth/device/token", { code: code.deviceCode, client_id: clientOf(caller) }, { ...caller, token: undefined });
  switch (answer.status) {
    case 200: {
      const tokens = readTokens(answer.body, now);
      return tokens ? { state: "allowed", tokens } : { state: "invalid" };
    }
    case 400:
      return { state: "waiting" };
    case 429:
      return { state: "waiting", slower: true };
    case 404:
      return { state: "invalid" };
    case 409:
      return { state: "used" };
    case 410:
      return { state: "expired" };
    case 418:
      return { state: "denied" };
    default:
      if (answer.status >= 500) return { state: "waiting" };
      return { state: "invalid" };
  }
}

/**
 * Polls until the user allows `code`, refuses it, or it runs out; `onSlower` hears when Trakt
 * asks for longer waits. Stops when `signal` aborts (the user closed the sign-in).
 */
export async function waitForDeviceSignIn(
  code: DeviceCode,
  {
    signal,
    sleep = (ms, s) => new Promise((go, stop) => {
      const t = setTimeout(go, ms);
      s?.addEventListener("abort", () => (clearTimeout(t), stop(s.reason)), { once: true });
    }),
    now = Date.now,
    ...caller
  }: Omit<TraktCaller, "token"> & { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; now?: () => number } = {},
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
    if (result.slower) interval = Math.min(interval + 5000, 60_000);
  }
}

/** Who signed in: the account's slug and name, from Trakt's settings for the user. */
export async function traktViewer(caller: TraktCaller): Promise<{ slug: string; name: string }> {
  const body = await trakt("GET", "/users/settings", undefined, caller);
  const user = isRecord(body) && isRecord(body.user) ? body.user : {};
  const ids = isRecord(user.ids) ? user.ids : {};
  const slug = str(ids.slug) ?? str(user.username);
  if (!slug) throw new TraktError("Trakt didn't say who signed in", 0);
  return { slug, name: str(user.name) || str(user.username) || slug };
}

/** New tokens for `link`; Trakt refusing the refresh token signs the profile out. */
export async function refreshTrakt(link: TraktLink, caller: Omit<TraktCaller, "token"> & { now?: number } = {}): Promise<TraktLink> {
  const answer = await traktRaw(
    "POST",
    "/oauth/token",
    { refresh_token: link.refreshToken, client_id: clientOf(caller), grant_type: "refresh_token" },
    caller,
  );
  if (answer.status === 400 || answer.status === 401) throw new TraktSignedOut();
  if (answer.status < 200 || answer.status >= 300) throw new TraktError(`Trakt answered ${answer.status}`, answer.status);
  const tokens = readTokens(answer.body, caller.now ?? Date.now());
  if (!tokens) throw new TraktSignedOut();
  return { ...link, ...tokens };
}

/** Tells Trakt the token is no longer used (unlinking). Failing to reach Trakt doesn't stop the unlink. */
export async function revokeTrakt(token: string, caller: Omit<TraktCaller, "token"> = {}): Promise<void> {
  await traktRaw("POST", "/oauth/revoke", { token, client_id: clientOf(caller) }, caller).catch(() => undefined);
}
