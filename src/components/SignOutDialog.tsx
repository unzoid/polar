import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { useAccount } from "../lib/account";
import { SignOut } from "./icons";
import { Button } from "./ui/Button";

/**
 * Asks before sign-out drops changes that haven't reached the account yet (critique C2). Opens
 * when `signOut()` stopped to ask; signing out drops every profile's copy from this device.
 * Uses the Watch Party dialog's look (styles/party.css) until there is one shared Dialog.
 */
export function SignOutDialog() {
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
          <Dialog.Title className="party-dialog-title">Some changes haven't synced</Dialog.Title>
          <Dialog.Description className="party-dialog-text">
            {count === 1
              ? "1 change to your library, playlists or watch history hasn't"
              : `${count ?? 0} changes to your library, playlists or watch history haven't`}{" "}
            reached your account yet. Signing out now removes them from this device for good.
          </Dialog.Description>
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
