/**
 * Autocrop's lookahead (docs/autocrop.md §4) in the video playing now, as
 * `mpv_lookahead` reports it (`preroll::Lookahead`), and the line Settings →
 * Advanced adds under "Look ahead for bar changes".
 */

export type LookaheadState = "reading" | "this-device" | "no-reader" | "not-opened" | "live" | "no-seeking" | "stopped";

const why: Record<Exclude<LookaheadState, "reading" | "this-device">, string> = {
  "no-reader": "a second player for reading ahead didn't start",
  "not-opened": "its source wouldn't open a second time",
  live: "it's a live stream, with nothing ahead to read",
  "no-seeking": "its source can't jump ahead from keyframe to keyframe",
  stopped: "its source stopped answering the reader",
};

/** The setting's caption, with what the lookahead does in the video playing now (`null`: nothing playing). */
export function lookaheadCaption(caption: string, state: LookaheadState | null): string {
  if (state === null) return caption;
  if (state === "reading") return `${caption} Reading ahead in the video playing now.`;
  if (state === "this-device") return `${caption} Not available on this device yet.`;
  return `${caption} Not reading ahead in the video playing now: ${why[state]}.`;
}
