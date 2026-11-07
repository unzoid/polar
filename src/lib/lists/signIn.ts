/**
 * Signing a profile in to AniList (#83). AniList's implicit grant: the app opens AniList's page
 * in the browser, the user allows Polarity, and AniList hands back an access token. With the PIN
 * page as the client's redirect, AniList shows the token for the user to paste here; a link
 * opened back into the app (`…#access_token=…&expires_in=…`) carries the same thing, so both are
 * read by {@link readSignIn}.
 *
 * Tokens can do anything the account can (AniList has no scopes) and last a year, with no
 * refresh: the user signs in again when one runs out.
 */

/**
 * The AniList API client Polarity signs in through: public, made once in AniList's developer
 * settings. Empty until it is registered; the sign-in then says it isn't set up in this build.
 */
export const ANILIST_CLIENT_ID = "";

/** How long a token lasts when neither it nor the redirect says: AniList's year. */
export const ANILIST_TOKEN_LIFE = 365 * 24 * 60 * 60_000;

/** AniList's sign-in page for `clientId`, or `null` when this build has no client. */
export function anilistAuthorizeUrl(clientId: string = ANILIST_CLIENT_ID): string | null {
  if (!/^\d+$/.test(clientId)) return null;
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&response_type=token`;
}

export interface SignIn {
  token: string;
  /** When the token stops working, in ms since the epoch. */
  expiresAt: number;
}

/** A JWT's three base64url parts. AniList's tokens are about a thousand characters. */
const JWT = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const MAX_TOKEN = 4096;

/**
 * What the user pasted, or the link the browser opened back into the app, as a sign-in: a bare
 * token, or a URL or fragment with `access_token` (and `expires_in`, in seconds). `null` when it
 * holds no token. The expiry comes from the redirect, else the token's own `exp`, else a year.
 */
export function readSignIn(text: string, now: number): SignIn | null {
  const s = text.trim();
  if (!s || s.length > MAX_TOKEN * 2) return null;
  let token = s;
  let expiresIn: number | undefined;
  const hash = s.indexOf("#");
  if (hash >= 0 || s.includes("access_token=")) {
    const params = new URLSearchParams(hash >= 0 ? s.slice(hash + 1) : s.slice(s.indexOf("?") + 1));
    const found = params.get("access_token");
    if (!found) return null;
    token = found;
    const seconds = Number(params.get("expires_in"));
    if (Number.isFinite(seconds) && seconds > 0) expiresIn = seconds * 1000;
  }
  if (token.length > MAX_TOKEN || !JWT.test(token)) return null;
  const exp = jwtExpiry(token);
  const expiresAt = expiresIn !== undefined ? now + expiresIn : (exp ?? now + ANILIST_TOKEN_LIFE);
  if (expiresAt <= now) return null;
  return { token, expiresAt };
}

/** The `exp` claim of a JWT, in ms, when it has one; the token is not checked, only read. */
function jwtExpiry(token: string): number | undefined {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims: unknown = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")));
    const exp = typeof claims === "object" && claims !== null ? (claims as { exp?: unknown }).exp : undefined;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
