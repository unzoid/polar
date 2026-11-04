import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { keys } from "../lib/queryKeys";
import { Close } from "./icons";
import { IconButton } from "./ui/Button";
import { Toast } from "./ui/Toast";

/**
 * Says so when Polar couldn't read its saved data at start-up (critique C1): it then keeps
 * changes only until it quits rather than write over a file that may still be fine.
 */
export function StoreProblemToast({ tv }: { tv: boolean }) {
  const { data: problem } = useQuery({ queryKey: keys.storeProblem, queryFn: api.storeProblem, staleTime: Infinity });
  const [dismissed, setDismissed] = useState(false);
  if (!problem || dismissed) return null;
  return (
    <Toast
      variant={tv ? "tv" : undefined}
      actions={
        !tv && (
          <IconButton label="Dismiss" onClick={() => setDismissed(true)}>
            <Close size={18} />
          </IconButton>
        )
      }
    >
      <strong>Your saved data couldn't be read</strong>
      <span>Changes now won't be saved. Quit Polar, check the file, then open it again.</span>
      <span>{problem}</span>
    </Toast>
  );
}
