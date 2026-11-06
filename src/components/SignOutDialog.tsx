import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import { useAccount } from "../lib/account";
import { warnFailed } from "../lib/errors";
import { nativeDialogsAvailable, showNativeDialog } from "../lib/platform";
import { SignOut } from "./icons";
import { Button } from "./ui/Button";

/**
 * Asks before sign-out drops changes that haven't reached the account yet (critique C2). Opens
 * when `signOut()` stopped to ask; signing out drops every profile's copy from this device.
 * Uses the Watch Party dialog's look (styles/party.css) until there is one shared Dialog; on iOS the system's alert.
 */
export function SignOutDialog() {
  return nativeDialogsAvailable ? <NativeSignOutAlert /> : <WebSignOutDialog />;
}

const TITLE = "Some changes haven't synced";

function unsyncedText(count: number | null) {
  return `${
    count === 1 ? "1 change to your library, playlists or watch history hasn't" : `${count ?? 0} changes to your library, playlists or watch history haven't`
  } reached your account yet. Signing out now removes them from this device for good.`;
}

/** iOS: the same question as an alert; asked again when Try Again still can't reach the account. */
function NativeSignOutAlert() {
  const account = useAccount();
  const count = account.signOutBlocked;
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (count === null) return;
    const actions = [
      { id: "retry", label: "Try Again", style: "default" as const },
      { id: "discard", label: "Sign Out Anyway", style: "destructive" as const },
      { id: "cancel", label: "Cancel", style: "cancel" as const },
    ];
    showNativeDialog({ kind: "alert", title: TITLE, message: unsyncedText(count), actions })
      .then(async (picked) => {
        if (picked === "retry") await account.signOut().finally(() => setRound((r) => r + 1));
        else if (picked === "discard") await account.signOut({ discard: true });
        else account.cancelSignOut();
      })
      .catch(warnFailed("sign-out question"));
    // A new question per blocked sign-out (or round), not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, round]);
  return null;
}

function WebSignOutDialog() {
  const account = useAccount();
  const [busy, setBusy] = useState<"retry" | "discard" | null>(null);
  const count = account.signOutBlocked;

  const run = async (kind: "retry" | "discard") => {
    setBusy(kind);
    try {
      await account.signOut(kind === "discard" ? { discard: true } : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog.Root open={count !== null} onOpenChange={(o) => !o && !busy && account.cancelSignOut()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="party-dialog-scrim" />
        <Dialog.Popup className="party-dialog">
          <div className="party-dialog-icon" aria-hidden>
            <SignOut size={22} />
          </div>
          <Dialog.Title className="party-dialog-title">{TITLE}</Dialog.Title>
          <Dialog.Description className="party-dialog-text">{unsyncedText(count)}</Dialog.Description>
          <div className="sign-out-dialog-actions">
            <Button variant="accent" size="block" busy={busy === "retry"} disabled={!!busy} onClick={() => void run("retry")}>
              Try Again
            </Button>
            <Button variant="danger" size="block" busy={busy === "discard"} disabled={!!busy} onClick={() => void run("discard")}>
              Sign Out Anyway
            </Button>
            <Dialog.Close render={<Button size="block" disabled={!!busy} />}>Cancel</Dialog.Close>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
