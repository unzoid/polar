import { trakt, TraktError, TraktSignedOut, type TraktCaller } from "./api";
import { scrobbleBody, type TraktRef } from "./items";
import type { TraktLink } from "./link";

/**
 * Scrobbling (#85): what plays in Polarity is told to Trakt as it plays. `start` when it plays or
 * resumes, `pause` when it pauses, `stop` when it stops or the player closes, each with how far
 * in it is (0–100). Trakt counts a stop past 80% as watched and keeps an earlier one as playback
 * to resume (for 6 months). Scrobbles aren't queued: one that can't go out is left out, and a
 * watched one goes into the history queue instead (useTraktScrobble).
 */
export type ScrobbleAction = "start" | "pause" | "stop";

/** Trakt's line between a stop that counts as watched and one kept to resume. */
export const TRAKT_WATCHED = 80;

export interface ScrobbleDeps {
  liveLink: (renew: boolean) => Promise<TraktLink | undefined>;
  send: (path: string, body: unknown, caller: TraktCaller) => Promise<unknown>;
}

/**
 * Sends one scrobble. Returns what Trakt made of it: `watched` (a stop it counted), `sent`, or
 * `none` when there is no usable link or it couldn't go out. A 409 (the same scrobble just went
 * out) counts as sent.
 */
export async function scrobble(action: ScrobbleAction, ref: TraktRef, progress: number, deps: ScrobbleDeps): Promise<"watched" | "sent" | "none"> {
  const p = Math.round(Math.min(Math.max(progress, 0), 100) * 100) / 100;
  const body = { ...scrobbleBody(ref), progress: p };
  for (const renew of [false, true]) {
    const link = await deps.liveLink(renew).catch(() => undefined);
    if (!link) return "none";
    try {
      await deps.send(`/scrobble/${action}`, body, { token: link.token });
    } catch (e) {
      if (e instanceof TraktSignedOut && !renew) continue;
      if (!(e instanceof TraktError && e.status === 409)) return "none";
    }
    return action === "stop" && p >= TRAKT_WATCHED ? "watched" : "sent";
  }
  return "none";
}

export const sendScrobble = (path: string, body: unknown, caller: TraktCaller) => trakt("POST", path, body, caller);
