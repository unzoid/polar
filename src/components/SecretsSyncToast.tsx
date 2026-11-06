import { useEffect, useState } from "react";
import { onFirstPlainSync } from "../lib/account";
import { usePartySurface } from "../lib/party";
import { usePresence } from "../lib/ui";
import { Close } from "./icons";
import { showWhereStored } from "./settings/secretsNote";
import { SAVE_FAILURE_MS, TOAST_OUT_MS } from "./StoreProblemToast";
import { Button, IconButton } from "./ui/Button";
import { Toast } from "./ui/Toast";

/**
 * Once per profile on a device (#195): the first sync took this device's API keys or keyed add-on
 * links to the account without a passphrase, so the server can read them. Stays until dismissed,
 * except on TV, where nothing is typed and it goes after a while. Waits while a watch party
 * dialog or panel is up, rather than covering it (#247).
 */
export function SecretsSyncToast({ tv }: { tv: boolean }) {
  const [space, setSpace] = useState<string | null>(null);
  useEffect(() => onFirstPlainSync(setSpace), []);
  const waiting = !!usePartySurface();
  useEffect(() => {
    if (!space || !tv || waiting) return;
    const t = setTimeout(() => setSpace(null), SAVE_FAILURE_MS);
    return () => clearTimeout(t);
  }, [space, tv, waiting]);
  const { shown, leaving } = usePresence(waiting ? null : space, TOAST_OUT_MS);
  if (!shown) return null;
  const actions = (
    <>
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          setSpace(null);
          showWhereStored();
        }}
      >
        Set a Passphrase
      </Button>
      <IconButton label="Dismiss" onClick={() => setSpace(null)}>
        <Close size={18} />
      </IconButton>
    </>
  );
  return (
    <Toast variant={tv ? "tv" : undefined} lines actions={!tv && actions} leaving={leaving} className="store-toast" data-kind="secrets-plain">
      <strong>Your API keys now sync unencrypted</strong>
      <span>
        This device's keys and add-on links went to your account as they are: anyone with access to the account server could read them. Set a passphrase
        {tv ? " in Settings → Account on a computer or phone" : ""} to encrypt them.
      </span>
    </Toast>
  );
}
