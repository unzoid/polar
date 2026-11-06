import { useEffect, useRef, useState } from "react";
import { IconButton } from "../ui/Button";
import { SkipIcon } from "./icons";

/** How long after the last press the total stays out before the number goes back in the ring. */
const HOLD_MS = 800;

/**
 * A centre skip button, Netflix-style: each press (bumping `kick`) sends the
 * number out of the ring to the side it jumps to, where it reads "+10", then
 * "+20", "+30" as presses keep coming. Once they stop, the total fades and the
 * number slides back into the ring.
 */
export function SeekButton({
  direction,
  seconds,
  kick,
  onPress,
  label,
  title,
}: {
  direction: "back" | "forward";
  seconds: number;
  /** Bumped once per seek from this button, a double-tap, or the seek keys and controller (Player.tsx). */
  kick: number;
  onPress: () => void;
  label: string;
  title: string;
}) {
  const [total, setTotal] = useState(0);
  // The last total stays in the label while it fades out.
  const [shown, setShown] = useState(0);
  const last = useRef(kick);
  useEffect(() => {
    if (kick === last.current) return;
    last.current = kick;
    setTotal((t) => t + seconds);
    // Each press restarts the hold, so a burst keeps the total out.
    const t = setTimeout(() => setTotal(0), HOLD_MS);
    return () => clearTimeout(t);
  }, [kick, seconds]);
  useEffect(() => {
    if (total > 0) setShown(total);
  }, [total]);

  return (
    <div className="seek-control" data-direction={direction} data-active={total > 0}>
      <IconButton variant="transport" onClick={onPress} label={label} title={title}>
        <SkipIcon direction={direction} seconds={seconds} size={56} kick={kick} numberOut={total > 0} />
      </IconButton>
      <span className="seek-amount tabular" aria-hidden>
        {direction === "back" ? "−" : "+"}
        {shown}
      </span>
    </div>
  );
}
