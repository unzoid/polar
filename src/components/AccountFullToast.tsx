import { useEffect, useState } from "react";
import { onAccountFull } from "../lib/account/accountFull";
import type { AccountError } from "../lib/account/backend";
import { usePresence } from "../lib/ui";
import { Close } from "./icons";
import { SAVE_FAILURE_MS, TOAST_OUT_MS } from "./StoreProblemToast";
import { IconButton } from "./ui/Button";
import { Toast } from "./ui/Toast";

/**
 * Says so when the account has no room left for a kind of row (#110): the library, the watch
 * history, anime choices or playlists. Changes of that kind stay on this device and sync keeps
 * trying; everything else goes on syncing.
 */
export function AccountFullToast({ tv }: { tv: boolean }) {
  const [full, setFull] = useState<AccountError | null>(null);
  useEffect(() => onAccountFull(setFull), []);
  useEffect(() => {
    if (!full) return;
    const t = setTimeout(() => setFull(null), SAVE_FAILURE_MS);
    return () => clearTimeout(t);
  }, [full]);
  const { shown, leaving } = usePresence(full, TOAST_OUT_MS);
  if (!shown) return null;
  const dismiss = (
    <IconButton label="Dismiss" onClick={() => setFull(null)}>
      <Close size={18} />
    </IconButton>
  );
  return (
    <Toast variant={tv ? "tv" : undefined} lines actions={!tv && dismiss} leaving={leaving} className="store-toast" data-kind="account-full">
      <strong>Your account is full</strong>
      <span>New changes of this kind stay on this device. Removing some makes room, then they sync.</span>
      <span className="toast-detail">{shown.message}</span>
    </Toast>
  );
}
