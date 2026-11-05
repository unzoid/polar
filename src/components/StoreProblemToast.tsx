import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { onSaveFailure } from "../lib/errors";
import { keys } from "../lib/net";
import { Close } from "./icons";
import { IconButton } from "./ui/Button";
import { Toast } from "./ui/Toast";

/** How long a save failure stays up; another failure brings it back. */
const SAVE_FAILURE_MS = 12_000;

/**
 * Says so when Polarity couldn't read its saved data at start-up (critique C1): it then keeps
 * changes only until it quits rather than write over a file that may still be fine. And says so
 * whenever a change couldn't be saved (test report 1, item 3): the newest of the two shows.
 */
export function StoreProblemToast({ tv }: { tv: boolean }) {
  const { data: problem } = useQuery({ queryKey: keys.storeProblem, queryFn: api.storeProblem, staleTime: Infinity });
  const [dismissed, setDismissed] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => onSaveFailure(setFailure), []);
  useEffect(() => {
    if (!failure) return;
    const t = setTimeout(() => setFailure(null), SAVE_FAILURE_MS);
    return () => clearTimeout(t);
  }, [failure]);

  const dismiss = (
    <IconButton label="Dismiss" onClick={() => (failure ? setFailure(null) : setDismissed(true))}>
      <Close size={18} />
    </IconButton>
  );
  if (failure) {
    return (
      <Toast variant={tv ? "tv" : undefined} lines actions={!tv && dismiss} data-kind="save-failed">
        <strong>Couldn't save your change</strong>
        <span>{problem ? "Polarity couldn't read its saved data, so changes last only until it quits." : "It's kept until Polarity quits."}</span>
        <span className="toast-detail">{failure}</span>
      </Toast>
    );
  }
  if (!problem || dismissed) return null;
  return (
    <Toast variant={tv ? "tv" : undefined} lines actions={!tv && dismiss}>
      <strong>Your saved data couldn't be read</strong>
      <span>Changes now won't be saved. Quit Polarity, check the file, then open it again.</span>
      <span className="toast-detail">{problem}</span>
    </Toast>
  );
}
