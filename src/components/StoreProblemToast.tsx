import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { onSaveFailure } from "../lib/errors";
import { keys } from "../lib/net";
import { usePresence } from "../lib/ui";
import { Close } from "./icons";
import { IconButton } from "./ui/Button";
import { TOAST_OUT_MS, Toast } from "./ui/Toast";

/** How long a save failure stays up; another failure, even with the same text, starts it again. */
export const SAVE_FAILURE_MS = 12_000;
export { TOAST_OUT_MS };

type Shown = { kind: "failure"; message: string } | { kind: "problem"; message: string };

/**
 * Says so when Polarity couldn't read its saved data at start-up (critique C1): it then keeps
 * changes only until it quits rather than write over a file that may still be fine. And says so
 * whenever a change couldn't be saved (test report 1, item 3): the newest of the two shows.
 * Above every window (Settings included: re-test 3d), since it reports what was just done there.
 */
export function StoreProblemToast({ tv }: { tv: boolean }) {
  const { data: problem } = useQuery({ queryKey: keys.storeProblem, queryFn: api.storeProblem, staleTime: Infinity });
  const [dismissed, setDismissed] = useState(false);
  // A new object each time, so a repeat of the same message restarts the time-out (re-test 3b).
  const [failure, setFailure] = useState<{ message: string } | null>(null);
  useEffect(() => onSaveFailure((message) => setFailure({ message })), []);
  useEffect(() => {
    if (!failure) return;
    const t = setTimeout(() => setFailure(null), SAVE_FAILURE_MS);
    return () => clearTimeout(t);
  }, [failure]);

  const now: Shown | null = failure ? { kind: "failure", message: failure.message } : problem && !dismissed ? { kind: "problem", message: problem } : null;
  const { shown, leaving } = usePresence(now, TOAST_OUT_MS);
  if (!shown) return null;
  const dismiss = (
    <IconButton label="Dismiss" onClick={() => (failure ? setFailure(null) : setDismissed(true))}>
      <Close size={18} />
    </IconButton>
  );
  const common = { variant: tv ? ("tv" as const) : undefined, lines: true, actions: !tv && dismiss, leaving, className: "store-toast" };
  if (shown.kind === "failure") {
    return (
      <Toast {...common} data-kind="save-failed">
        <strong>Couldn't save your change</strong>
        <span>{problem ? "Polarity couldn't read its saved data, so changes last only until it quits." : "It's kept until Polarity quits."}</span>
        <span className="toast-detail">{shown.message}</span>
      </Toast>
    );
  }
  return (
    <Toast {...common}>
      <strong>Your saved data couldn't be read</strong>
      <span>Changes now won't be saved. Quit Polarity, check the file, then open it again.</span>
      <span className="toast-detail">{shown.message}</span>
    </Toast>
  );
}
