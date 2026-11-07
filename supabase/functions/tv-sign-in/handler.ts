/**
 * The tv-sign-in Edge Function's logic (#133), apart from Deno and Supabase so it's tested in Bun
 * (tests/tvSignInFunction.test.ts); index.ts plugs in the database and the admin API. One POST with
 * a JSON body; `action` says which step:
 *
 * - `start` (the TV, not signed in): `{ device }` → `{ code, poll, expiresIn }` (seconds: the TV's
 *   clock may be off). The TV shows the code and keeps `poll` to itself.
 * - `look` (signed in): `{ code }` → `{ device }`: what the user is asked to approve.
 * - `answer` (signed in): `{ code, approve }` → `{ ok: true }`.
 * - `claim` (the TV): `{ poll }` → `{ state: "pending" | "denied" | "expired" }`, or
 *   `{ state: "approved", tokenHash }`: a one-time sign-in token for the approving account, which
 *   the TV exchanges for a session of its own. Handed out once.
 *
 * Errors: `{ error }` with `bad_request` (400), `signed_out` (401), `invalid_code` (404),
 * `rate_limited` (429) or `unknown` (500). Codes, secrets and the caller's address are only ever
 * stored hashed (supabase/migrations/20261109000000_tv_sign_in.sql).
 */

/** What the function needs from the database and the auth server. */
export interface TvSignInDeps {
  /** The request's expiry (ISO). Throws an error whose message is `rate_limited` past a limit. */
  start(codeHash: string, pollHash: string, device: string, ipHash: string): Promise<string>;
  /** The device name of a live request, or null. Throws `rate_limited` past the user's limit. */
  look(userId: string, codeHash: string): Promise<string | null>;
  /** False when there's no such request; then it counts towards the user's limit like `look`, and throws `rate_limited` past it. */
  answer(userId: string, codeHash: string, approve: boolean): Promise<boolean>;
  claim(pollHash: string): Promise<{ state: string; userId: string | null }>;
  /** The user a session's access token belongs to, or null. */
  userOf(accessToken: string): Promise<string | null>;
  /** A one-time sign-in token's hash for the user, or null if there's no such user. */
  signInToken(userId: string): Promise<string | null>;
  /** Keys the hash of the caller's address, so the stored hash can't be reversed by trying every address. */
  secret: string;
  random(bytes: number): Uint8Array;
  now(): number;
}

/** No 0/O, 1/I/L: read off a TV across the room and typed on a phone. 31 characters, 8 of them: about 40 bits. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;
export const DEVICE_MAX = 40;
const BODY_MAX = 2048;
/** Codes collide rarely; a few tries find a free one. */
const CODE_TRIES = 4;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The code as typed: case and anything but its letters and digits don't matter. */
export const normalizeCode = (typed: string) => typed.toUpperCase().replace(/[^A-Z0-9]/g, "");

const isCode = (code: string) => code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));

/** The device name as shown: trimmed, without control characters, at most `DEVICE_MAX` characters. */
export function cleanDevice(name: unknown): string | null {
  if (typeof name !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const clean = [...name.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()].slice(0, DEVICE_MAX).join("").trim();
  return clean || null;
}

const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const sha256 = async (text: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

async function hmac(key: string, text: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text)));
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A code from `random`, each character equally likely: bytes past the last whole round of the alphabet are skipped. */
function newCode(random: (n: number) => Uint8Array) {
  const n = CODE_ALPHABET.length;
  const below = 256 - (256 % n);
  let code = "";
  while (code.length < CODE_LENGTH)
    for (const b of random(CODE_LENGTH)) if (b < below && code.length < CODE_LENGTH) code += CODE_ALPHABET[b % n];
  return code;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class Refusal extends Error {
  constructor(
    public code: "bad_request" | "signed_out" | "invalid_code" | "rate_limited",
    public status: number,
  ) {
    super(code);
  }
}

const isRateLimit = (e: unknown) => e instanceof Error && /rate_limited/.test(e.message);

/** The caller's address as the platform's proxy saw it: the first `x-forwarded-for` entry. */
const callerAddress = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";

export async function handleTvSignIn(req: Request, deps: TvSignInDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);
  try {
    const text = await req.text();
    if (text.length > BODY_MAX) throw new Refusal("bad_request", 400);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch {
      throw new Refusal("bad_request", 400);
    }

    const signedIn = async () => {
      const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
      const user = token ? await deps.userOf(token).catch(() => null) : null;
      if (!user) throw new Refusal("signed_out", 401);
      return user;
    };
    const codeHash = async () => {
      const code = typeof body.code === "string" ? normalizeCode(body.code) : "";
      if (!isCode(code)) throw new Refusal("invalid_code", 404);
      return sha256(code);
    };

    switch (body.action) {
      case "start": {
        const device = cleanDevice(body.device);
        if (!device) throw new Refusal("bad_request", 400);
        const ipHash = await hmac(deps.secret, callerAddress(req));
        const poll = base64url(deps.random(32));
        const pollHash = await sha256(poll);
        for (let i = 0; ; i++) {
          const code = newCode(deps.random);
          try {
            const expiresAt = Date.parse(await deps.start(await sha256(code), pollHash, device, ipHash));
            return json({ code, poll, expiresIn: Math.max(0, Math.round((expiresAt - deps.now()) / 1000)) });
          } catch (e) {
            // A code that's taken: another one. Anything else stops here.
            if (isRateLimit(e) || i + 1 >= CODE_TRIES || !/duplicate|unique/i.test(e instanceof Error ? e.message : "")) throw e;
          }
        }
      }
      case "look": {
        const user = await signedIn();
        const device = await deps.look(user, await codeHash());
        if (device === null) throw new Refusal("invalid_code", 404);
        return json({ device });
      }
      case "answer": {
        const user = await signedIn();
        if (typeof body.approve !== "boolean") throw new Refusal("bad_request", 400);
        if (!(await deps.answer(user, await codeHash(), body.approve))) throw new Refusal("invalid_code", 404);
        return json({ ok: true });
      }
      case "claim": {
        const poll = typeof body.poll === "string" && /^[A-Za-z0-9_-]{43}$/.test(body.poll) ? body.poll : "";
        if (!poll) throw new Refusal("bad_request", 400);
        const { state, userId } = await deps.claim(await sha256(poll));
        if (state !== "approved" || !userId) return json({ state: state === "pending" || state === "denied" ? state : "expired" });
        const tokenHash = await deps.signInToken(userId);
        return json(tokenHash ? { state: "approved", tokenHash } : { state: "expired" });
      }
      default:
        throw new Refusal("bad_request", 400);
    }
  } catch (e) {
    if (e instanceof Refusal) return json({ error: e.code }, e.status);
    if (isRateLimit(e)) return json({ error: "rate_limited" }, 429);
    console.error("tv-sign-in:", e instanceof Error ? e.message : "failed");
    return json({ error: "unknown" }, 500);
  }
}
