/**
 * The party log (#203): what this device saw of the room — joins, presence
 * lists, timeline and rules messages with their versions, reconnects, who's
 * host — so a session that went wrong can be compared from both ends with
 * "Copy party log".
 *
 * Nothing personal goes in: members are the first characters of their
 * random per-party ids (the same on every device, so two logs line up), never
 * names or avatars; no party code (it lets anyone in), no title or video ids,
 * no stream links. Only `room.ts` writes to it, and only these shapes.
 */

export interface PartyLogLine {
  /** Monotonic ms (the room's clock). */
  at: number;
  text: string;
}

/** Enough for a few minutes of a busy room; the oldest lines drop off. */
const MAX_LINES = 600;

/** A member as the log names it. */
export const tag = (id: string | null | undefined) => (id ? id.slice(0, 8) : "nobody");

export function createPartyLog(max = MAX_LINES) {
  let lines: PartyLogLine[] = [];
  /** Wall-clock and monotonic time at the start, to give each line a time two devices can line up. */
  let start: { wall: number; at: number } | null = null;
  let dropped = 0;
  return {
    /** A new party: the last one's lines go. */
    reset(wall: number, at: number) {
      lines = [];
      dropped = 0;
      start = { wall, at };
    },
    add(at: number, text: string) {
      if (!start) return;
      lines.push({ at, text });
      if (lines.length > max) {
        lines = lines.slice(-max);
        dropped++;
      }
    },
    lines: () => lines,
    /** The log as text, `summary` lines first (who's in now, round trip). */
    text(summary: string[] = []) {
      if (!start) return "No watch party yet on this device.";
      const s = start;
      const head = [
        "Polarity watch party log",
        `Started ${new Date(s.wall).toISOString()}; times below are seconds since then, by this device's clock.`,
        ...summary,
        ...(dropped ? ["(older lines dropped)"] : []),
        "",
      ];
      return [...head, ...lines.map((l) => `+${((l.at - s.at) / 1000).toFixed(3).padStart(9)}  ${l.text}`)].join("\n");
    },
  };
}

export type PartyLog = ReturnType<typeof createPartyLog>;
