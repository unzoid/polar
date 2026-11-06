import { useContext, useState, type ReactNode } from "react";
import { AccountContext, secretsState, setSecretsPassphrase, sync } from "../../lib/account";
import { Button } from "../ui/Button";
import { FormRow } from "./rows";
import { showWhereStored } from "./secretsNote";

/** What is about to be saved: one key, several, or an add-on link that holds a key. */
export type KeyKind = "key" | "keys" | "link";

const HEADLINE: Record<KeyKind, string> = {
  key: "This key will be stored on your account unencrypted.",
  keys: "These keys will be stored on your account unencrypted.",
  link: "This add-on link contains a key. It will be stored on your account unencrypted.",
};

/** True while a signed-in profile's keys and add-on links sync readable (no passphrase). */
export function useSecretsPlain(): boolean {
  const account = useContext(AccountContext);
  return account?.status === "ready" && !!account.profile && secretsState(account.profile.id) === "plain";
}

/**
 * Asks before a new key or keyed add-on link is saved on a signed-in profile without a passphrase
 * (#195): `guard(kind, save)` saves straight away otherwise. Draw `warning` under the form; it offers
 * a passphrase right there, saving anyway, or not saving.
 */
export function useKeyGate(): { guard: (kind: KeyKind | null, save: () => void) => void; warning: ReactNode } {
  const account = useContext(AccountContext);
  const plain = useSecretsPlain();
  const [asking, setAsking] = useState<{ kind: KeyKind; save: () => void } | null>(null);
  const guard = (kind: KeyKind | null, save: () => void) => {
    if (kind && plain) setAsking({ kind, save });
    else {
      setAsking(null);
      save();
    }
  };
  const profileId = account?.status === "ready" ? account.profile?.id : undefined;
  const warning =
    asking && profileId ? (
      <KeyWarning
        kind={asking.kind}
        onPassphrase={(phrase) => {
          setSecretsPassphrase(profileId, phrase);
          setAsking(null);
          asking.save();
          void sync.flush().catch(() => {});
        }}
        onSave={() => {
          setAsking(null);
          asking.save();
        }}
        onCancel={() => setAsking(null)}
      />
    ) : null;
  return { guard, warning };
}

function KeyWarning({
  kind,
  onPassphrase,
  onSave,
  onCancel,
}: {
  kind: KeyKind;
  onPassphrase: (phrase: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [typing, setTyping] = useState(false);
  const [phrase, setPhrase] = useState("");
  return (
    <div className="settings-key-warning" role="alert" data-kind={kind}>
      <p className="settings-expand-text">
        <strong>{HEADLINE[kind]}</strong> Anyone with access to the account server could read it. Set a passphrase to encrypt it.
      </p>
      {typing ? (
        <>
          <p className="settings-expand-text">
            Each of your devices asks for it once. Nobody can get it back if it's forgotten; then you'd enter your keys and add-ons again.
          </p>
          <FormRow
            look="expand"
            type="password"
            placeholder="Passphrase"
            aria-label="Passphrase"
            autoComplete="new-password"
            autoFocus
            value={phrase}
            onChange={setPhrase}
            tidy={(v) => v}
            submit="Set and Save"
            onSubmit={onPassphrase}
          />
          <div className="settings-expand-form">
            <Button onClick={() => setTyping(false)}>Back</Button>
          </div>
        </>
      ) : (
        <div className="settings-expand-form">
          <Button variant="primary" onClick={() => setTyping(true)}>
            Set a Passphrase
          </Button>
          <Button onClick={onSave}>Save Anyway</Button>
          <Button variant="plain" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
      <p className="settings-expand-text">
        <button type="button" className="settings-link" onClick={showWhereStored}>
          What's stored where
        </button>
      </p>
    </div>
  );
}
