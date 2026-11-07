import { isRecord, str } from "../parse";
import { simkl, SimklError, SimklSignedOut, type SimklCaller } from "./api";
import { simklScrobbleBody, type SimklRef } from "./items";
import type { SimklLink } from "./link";

/**
 * Scrobbling (#86): what plays in Polarity is told to Simkl as the user plays, pauses and stops it,
 * never on a timer (Simkl has no heartbeat and fills in the time between from the runtime).
 * `start` when it plays or resumes, `pause` when it pauses, `stop` when it stops or the player
 * closes, each with how far in it is (0–100). Simkl counts a stop at 80% or more as watched
 * (answering `action: "scrobble"`) and keeps an earlier one as playback to resume. Scrobbles
 * aren't queued: one that can't go out is left out, and a watched one goes into the history
 * queue instead (useSimklScrobble).
 */
export type SimklScrobbleAction = "start" | "pause" | "stop";

/** Simkl's line between a stop that counts as watched and one kept to resume. */
export const SIMKL_WATCHED = 80;

export interface SimklScrobbleDeps {
  liveLink: (renew: boolean) => Promise<SimklLink | undefined>;
  send: (path: string, body: unknown, caller: SimklCaller) => Promise<unknown>;
}

/**
 * Sends one scrobble. Returns what Simkl made of it: `watched` (a stop it counted), `sent`, or
 * `none` when there is no usable link or it couldn't go out. A 409 on a stop (the same session was
 * completed within the hour) counts as watched.
 */
export async function scrobbleSimkl(
  action: SimklScrobbleAction,
  ref: SimklRef,
  progress: number,
  deps: SimklScrobbleDeps,
): Promise<"watched" | "sent" | "none"> {
  const p = Math.round(Math.min(Math.max(progress, 0), 100) * 100) / 100;
  const body = { ...simklScrobbleBody(ref), progress: p };
  for (const renew of [false, true]) {
    const link = await deps.liveLink(renew).catch(() => undefined);
    if (!link) return "none";
    try {
      const answer = await deps.send(`/scrobble/${action}`, body, { token: link.token });
      if (action !== "stop") return "sent";
      // Simkl says what it made of the stop; without an answer, its own line decides.
      const made = isRecord(answer) ? str(answer.action) : undefined;
      return made === "scrobble" || (made === undefined && p >= SIMKL_WATCHED) ? "watched" : "sent";
    } catch (e) {
      if (e instanceof SimklSignedOut && !renew) continue;
      if (action === "stop" && e instanceof SimklError && e.status === 409) return "watched";
      return "none";
    }
  }
  return "none";
}

export const sendSimklScrobble = (path: string, body: unknown, caller: SimklCaller) => simkl("POST", path, body, caller);
