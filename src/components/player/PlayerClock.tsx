import { formatTime } from "../../lib/format";
import type { MediaLike } from "./mpvMedia";
import { useMediaTime } from "./useMediaTime";

export const TIME_DISPLAYS = ["remaining", "elapsed", "endsAt"] as const;
export type TimeDisplay = (typeof TIME_DISPLAYS)[number];

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * The timeline clock (Settings → Playback; clicking it cycles). Its own
 * component: it is the one part of the controls that changes every second.
 */
export function PlayerClock({ media, display, rate, onCycle }: { media: MediaLike | null; display: TimeDisplay; rate: number; onCycle: () => void }) {
  // "Ends at" depends on the clock as well: select whole seconds left at this speed, format with the time now.
  const shown = useMediaTime(media, (t) =>
    display === "elapsed"
      ? `${formatTime(t.current)} / ${formatTime(t.duration)}`
      : display === "endsAt"
        ? Math.round((t.duration - t.current) / (rate || 1))
        : formatTime(t.duration - t.current),
  );
  // A live stream has no end (and an Infinity date would throw).
  const text = typeof shown !== "number" ? shown : Number.isFinite(shown) ? `Ends at ${clock.format(Date.now() + shown * 1000)}` : "Live";
  return (
    <button className="player-remaining tabular" onClick={onCycle} title="Change what the clock shows" aria-label={`${text}. Change what the clock shows`}>
      {text}
    </button>
  );
}
