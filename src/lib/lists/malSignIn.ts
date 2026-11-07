import { storeLocal } from "../errors";
import { isRecord, num, str, storedJson } from "../parse";
import { call } from "../platform/bridge";
import { SignedOut } from "./entry";

/**
 * Signing a profile in to MyAnimeList (#84). MAL's authorization code grant with PKCE (`plain`, the
 * only method MAL takes): Polarity makes a one-off verifier, opens MAL's page in the browser, the
 * user allows Polarity, and MAL sends the browser to the client's redirect address with a code.
 * Nothing listens there: the user copies the address the browser lands on and pastes it into
 * Settings, and the code is traded for tokens with the verifier (no client secret: Polarity has no
 * server to keep one).
 *
 * Access tokens last about a month and come with a refresh token that lasts about a month too:
 * the link is refreshed before it runs out, so a profile only signs in again after a month away.
 */

/**
 * The MyAnimeList API client Polarity signs in through, given to the build (`VITE_MAL_CLIENT_ID`)
 * rather than kept in the source. Without one the sign-in says it isn't set up in this build.
 */
export const MAL_CLIENT_ID = ((import.meta.env.VITE_MAL_CLIENT_ID as string | undefined) ?? "").trim();

/** Whether this build has a client to sign in through. */
export const malSignInReady = (clientId = MAL_CLIENT_ID) => /^[A-Za-z0-9]{8,64}$/.test(clientId);

/** The redirect address registered with the client: nothing answers it, its address carries the code. */
export const MAL_REDIRECT = "http://localhost/polarity-mal-sign-in";

/** How long a refresh token lasts when MAL doesn't say: its month. */
export const MAL_REFRESH_LIFE = 30 * 24 * 60 * 60_000;

/** How long a started sign-in waits for its code. */
const PENDING_LIFE = 30 * 60_000;

export interface MalTokens {
  token: string;
  expiresAt: number;
  refreshToken: string;
  /** When the refresh token stops working too, in ms. */
  refreshBy: number;
}

export type TokenRelay = (form: [string, string][]) => Promise<{ status: number; body: string }>;

const nativeTokenRelay: TokenRelay = (form) => call("mal_token", { form });

export const pendingKey = (space: string | null) => `polar.lists.pending.mal.${space ?? "local"}`;

const VERIFIER_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** `length` characters PKCE allows, from the system's random source. */
export function randomCode(length: number, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  // 66 characters: the remainder's slight lean toward the first few doesn't matter at this length.
  return Array.from(random(length), (b) => VERIFIER_CHARS[b % VERIFIER_CHARS.length]).join("");
}

/**
 * Starts a sign-in for the profile: keeps a new verifier and state on the device for the code to
 * come back to, and returns MAL's page to open. `null` when this build has no client.
 */
export function startMalSignIn(
  space: string | null,
  {
    storage = localStorage,
    now = Date.now(),
    clientId = MAL_CLIENT_ID,
    random,
  }: { storage?: Pick<Storage, "setItem">; now?: number; clientId?: string; random?: (n: number) => Uint8Array } = {},
): string | null {
  if (!malSignInReady(clientId)) return null;
  const verifier = randomCode(96, random);
  const state = randomCode(24, random);
  storeLocal(pendingKey(space), JSON.stringify({ verifier, state, at: now }), storage);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    code_challenge: verifier,
    code_challenge_method: "plain",
    state,
    redirect_uri: MAL_REDIRECT,
  });
  return `https://myanimelist.net/v1/oauth2/authorize?${params}`;
}

/** The sign-in this profile started, while it is still waiting. */
function pending(space: string | null, storage: Pick<Storage, "getItem">, now: number): { verifier: string; state: string } | undefined {
  const v = storedJson(storage, pendingKey(space));
  if (!isRecord(v)) return undefined;
  const [verifier, state, at] = [str(v.verifier), str(v.state), num(v.at)];
  return verifier && state && at !== undefined && now - at < PENDING_LIFE ? { verifier, state } : undefined;
}

const CODE = /^[A-Za-z0-9._~-]{8,4096}$/;

/**
 * The code in what the user pasted: the address the browser landed on (`…?code=…&state=…`), or
 * the code alone. `null` when it holds none, or one from another sign-in (its state differs).
 */
export function readMalCode(text: string, state: string): string | null {
  const s = text.trim();
  if (!s || s.length > 8192) return null;
  if (!s.includes("code=")) return CODE.test(s) ? s : null;
  const params = new URLSearchParams(s.slice(s.indexOf("?") + 1).split("#")[0]);
  const code = params.get("code");
  if (!code || !CODE.test(code)) return null;
  const said = params.get("state");
  return said === null || said === state ? code : null;
}

/** MAL's token answer as tokens; `null` when it isn't one. */
export function readTokens(body: string, now: number): MalTokens | null {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(v)) return null;
  const [token, refreshToken, expiresIn] = [str(v.access_token), str(v.refresh_token), num(v.expires_in)];
  if (!token || !refreshToken || token.length > 4096 || refreshToken.length > 4096) return null;
  return { token, refreshToken, expiresAt: now + (expiresIn && expiresIn > 0 ? expiresIn * 1000 : 60 * 60_000), refreshBy: now + MAL_REFRESH_LIFE };
}

/** The pasted code didn't come from the sign-in this profile started (or it waited too long). */
export class NoPendingSignIn extends Error {
  constructor() {
    super("No MyAnimeList sign-in is waiting for a code");
    this.name = "NoPendingSignIn";
  }
}

async function trade(form: [string, string][], relay: TokenRelay, now: number): Promise<MalTokens> {
  let answer: { status: number; body: string };
  try {
    answer = await relay(form);
  } catch {
    throw new TypeError("MyAnimeList can't be reached");
  }
  // 400 invalid_grant / 401: the code or refresh token is used up, run out or revoked.
  if (answer.status === 400 || answer.status === 401) throw new SignedOut("MyAnimeList");
  const tokens = answer.status === 200 ? readTokens(answer.body, now) : null;
  if (!tokens) throw new Error(`MyAnimeList answered ${answer.status}`);
  return tokens;
}

export interface MalSignInDeps {
  storage: Pick<Storage, "getItem" | "removeItem">;
  now: number;
  relay?: TokenRelay;
  clientId?: string;
}

/**
 * Trades the code in `pasted` for tokens, with the verifier of the sign-in the profile started.
 * Returns `null` when `pasted` holds no code; throws {@link NoPendingSignIn}, or what MAL answered.
 */
export async function finishMalSignIn(space: string | null, pasted: string, deps: MalSignInDeps): Promise<MalTokens | null> {
  const started = pending(space, deps.storage, deps.now);
  if (!started) throw new NoPendingSignIn();
  const code = readMalCode(pasted, started.state);
  if (!code) return null;
  const tokens = await trade(
    [
      ["client_id", deps.clientId ?? MAL_CLIENT_ID],
      ["grant_type", "authorization_code"],
      ["code", code],
      ["code_verifier", started.verifier],
      ["redirect_uri", MAL_REDIRECT],
    ],
    deps.relay ?? nativeTokenRelay,
    deps.now,
  );
  deps.storage.removeItem(pendingKey(space));
  return tokens;
}

/** New tokens for a refresh token; MAL revokes the old access token as it answers. */
export function refreshMal(refreshToken: string, now: number, relay: TokenRelay = nativeTokenRelay, clientId = MAL_CLIENT_ID): Promise<MalTokens> {
  return trade(
    [
      ["client_id", clientId],
      ["grant_type", "refresh_token"],
      ["refresh_token", refreshToken],
    ],
    relay,
    now,
  );
}
