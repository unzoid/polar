/**
 * Signing in on a TV from a device that's already signed in (#133). The TV asks the account server
 * for a short code and shows it; on a phone or computer, Settings → Account → Sign in a TV takes
 * the code and asks "Sign in on <device>?"; once approved, the TV gets a session of its own (the
 * other device's is never handed over, so signing out on one leaves the other signed in).
 *
 * Server side: supabase/functions/tv-sign-in and the tv_sign_in migration. Pure, apart from the
 * timers `waitForApproval` is given, so it's tested without a server (tests/tvSignIn.test.ts).
 */
import type { Os } from "../platform/device";
import type { FormFactor } from "../platform/formFactor";

/** Letters the code is made of: no 0/O, 1/I/L (supabase/functions/tv-sign-in/handler.ts). */
export const TV_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TV_CODE_LENGTH = 8;
/** How often the waiting device asks whether the code was approved. */
export const TV_POLL_MS = 3000;

/** The code as typed: case and anything but letters and digits don't matter. */
export const normalizeTvCode = (typed: string) => typed.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Whether `typed` can be a code at all (the server still decides whether it's a live one). */
export function isTvCode(typed: string) {
  const code = normalizeTvCode(typed);
  return code.length === TV_CODE_LENGTH && [...code].every((c) => TV_CODE_ALPHABET.includes(c));
}

/** As shown and as the field formats it while typing: two groups of four ("ABCD-EFGH"). */
export function formatTvCode(typed: string) {
  const code = normalizeTvCode(typed).slice(0, TV_CODE_LENGTH);
  return code.length > 4 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** What this device calls itself on the other device's "Sign in on …?": the kind of device, never a name. */
export function deviceLabel(os: Os, form: FormFactor, tvDevice: boolean): string {
  if (tvDevice) return os === "android" ? "Android TV" : "TV";
  if (form === "phone") return os === "ios" ? "iPhone" : "Android phone";
  if (form === "tablet") return os === "ios" ? "iPad" : "Android tablet";
  return { macos: "Mac", windows: "Windows PC", linux: "Linux computer", android: "Android device", ios: "iPad" }[os];
}

/** A request the server made for this device. */
export interface TvSignInRequest {
  code: string;
  /** The secret only this device has, to collect the answer with. */
  poll: string;
  /** Epoch ms. */
  expiresAt: number;
}

export type TvClaim = { state: "pending" | "denied" | "expired" } | { state: "approved"; tokenHash: string };

export type TvWaitResult = "approved" | "denied" | "expired" | "stopped";

/**
 * Asks every `TV_POLL_MS` until the request is answered or expires, then `onApproved` with the
 * token (which signs the device in). A failed ask (offline for a moment) is just tried again.
 * Resolves to how it ended; `signal` stops it.
 */
export async function waitForApproval(
  request: TvSignInRequest,
  {
    claim,
    onApproved,
    signal,
    now = Date.now,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  }: {
    claim: (poll: string) => Promise<TvClaim>;
    onApproved: (tokenHash: string) => Promise<void>;
    signal: AbortSignal;
    now?: () => number;
    sleep?: (ms: number) => Promise<unknown>;
  },
): Promise<TvWaitResult> {
  while (!signal.aborted) {
    await sleep(TV_POLL_MS);
    if (signal.aborted) break;
    // A little after the expiry: the server's clock decides, and it says "expired" itself.
    if (now() > request.expiresAt + 2 * TV_POLL_MS) return "expired";
    const answer = await claim(request.poll).catch(() => null);
    if (signal.aborted) break;
    if (!answer || answer.state === "pending") continue;
    if (answer.state !== "approved") return answer.state;
    await onApproved(answer.tokenHash);
    return "approved";
  }
  return "stopped";
}
