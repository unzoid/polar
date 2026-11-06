import { useMutation } from "@tanstack/react-query";
import { TextField } from "../../components/ui/TextField";
import { Edit, Lock, Trash } from "../../components/icons";
import { useState } from "react";
import { Avatar } from "../../components/Avatar";
import { removeSecretsPassphrase, secretsState, setSecretsPassphrase, settingsTooLarge, sync, unlockSecrets, useAccount } from "../../lib/account";
import { useSecretsNote } from "../../components/settings/secretsNote";
import { errorMessage } from "../../lib/errors";
import { Button } from "../../components/ui/Button";
import { ActionRow, Card, ExpandRow, FormRow, LinkRow, RowText, useExpanded, type Expandable } from "../../components/settings/rows";
import { StremioImport } from "../../components/settings/StremioImport";

export function AccountPage() {
  const account = useAccount();
  const expand = useExpanded();

  if (account.status === "guest") {
    return (
      <Card footer="Your library and watch history move into your first profile.">
        <ActionRow
          title="Not signed in"
          caption="Sign in to keep profiles, your library, history and settings on every device."
          label="Sign In"
          variant="primary"
          onClick={account.showSignIn}
        />
      </Card>
    );
  }

  return (
    <>
      <Card footer="Your library, where you are in each title, playlists, settings and shortcuts sync automatically. API keys, addons, volume and TV mode stay on this device.">
        <ActionRow title="Email" caption={account.user?.email} label="Sign Out" onClick={() => void account.signOut()} />
      </Card>

      <Card title="Profiles">
        {account.profiles.map((p) => (
          <div className="settings-row" key={p.id}>
            <Avatar id={p.avatar} style={{ width: 32, borderRadius: 7 }} />
            <RowText title={p.name} caption={p.id === account.profile?.id ? "Current profile" : undefined} />
          </div>
        ))}
        <LinkRow icon={Edit} title="Manage profiles" onClick={() => account.switchProfile("manage")} />
      </Card>

      <Card title="Sync">
        {account.profile && <SecretsRow profileId={account.profile.id} {...expand("secrets")} />}
        {settingsTooLarge() && (
          <p className="settings-error">This profile's settings are too large to sync. Add-on links take the most room: remove some to sync again.</p>
        )}
      </Card>

      <StremioImport />

      <Card title="Danger Zone">
        <DeleteAccountRow {...expand("delete")} />
      </Card>
    </>
  );
}

/**
 * API keys and add-on links sync for every account (#89): as they are, readable by the server under
 * row-level security, or sealed with an optional passphrase (account/secrets.ts) that stays on each
 * device, typed once on each.
 */
function SecretsRow({ profileId, ...props }: Expandable & { profileId: string }) {
  const note = useSecretsNote();
  const [phrase, setPhrase] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const state = secretsState(profileId);
  const change = async (fn: () => void) => {
    fn();
    setPhrase("");
    setConfirming(false);
    setBusy(true);
    await sync.flush().catch(() => {});
    setBusy(false);
  };
  return (
    <ExpandRow
      icon={Lock}
      title="API keys and addons"
      caption={state === "locked" ? "Encrypted with a passphrase this device doesn't have" : "Synced to your account"}
      value={state === "plain" ? "Not encrypted" : state === "sealed" ? "Encrypted" : "Locked"}
      {...props}
    >
      <p className="settings-expand-text">{note}</p>
      {state === "locked" && (
        <FormRow
          look="expand"
          type="password"
          placeholder="Passphrase"
          autoComplete="current-password"
          value={phrase}
          onChange={(v) => (setPhrase(v), setTried(false))}
          tidy={(v) => v}
          submit="Unlock"
          pending={busy}
          pendingLabel="Unlocking…"
          error={tried && !busy && "That passphrase doesn't open them."}
          onSubmit={(v) => void change(() => (unlockSecrets(profileId, v), setTried(true)))}
        />
      )}
      {state !== "locked" && (
        <>
          <p className="settings-expand-text">
            {state === "plain"
              ? "With a passphrase, the server holds them encrypted. Each of your devices asks for it once; nobody can get it back if it's forgotten, and then you'd enter your keys and addons again."
              : "Type a new passphrase to change it; your other devices then ask for the new one."}
          </p>
          <FormRow
            look="expand"
            type="password"
            placeholder={state === "plain" ? "Passphrase" : "New passphrase"}
            autoComplete="new-password"
            value={phrase}
            onChange={setPhrase}
            tidy={(v) => v}
            submit={state === "plain" ? "Set" : "Change"}
            pending={busy}
            pendingLabel="Encrypting…"
            onSubmit={(v) => void change(() => setSecretsPassphrase(profileId, v))}
          />
        </>
      )}
      {state === "sealed" && !confirming && (
        <div className="settings-expand-form">
          <Button variant="danger" onClick={() => setConfirming(true)} disabled={busy}>
            Remove Passphrase
          </Button>
        </div>
      )}
      {state === "sealed" && confirming && (
        <>
          <p className="settings-expand-text">
            Your API keys and addons will be stored readable on the server again, for every device on this account.
          </p>
          <div className="settings-expand-form">
            <Button variant="danger" onClick={() => void change(() => removeSecretsPassphrase(profileId))}>
              Remove
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </>
      )}
    </ExpandRow>
  );
}

function DeleteAccountRow(props: Expandable) {
  const account = useAccount();
  const [typed, setTyped] = useState("");
  const remove = useMutation({ mutationFn: () => account.deleteAccount() });
  return (
    <ExpandRow icon={Trash} title="Delete account" caption="Removes all profiles and synced data" {...props}>
      <p className="settings-expand-text">
        This can't be undone. Type <strong>delete</strong> to confirm.
      </p>
      <div className="settings-expand-form">
        <TextField value={typed} onChange={setTyped} placeholder="delete" />
        <Button
          variant="danger"
          disabled={typed.trim().toLowerCase() !== "delete" || remove.isPending}
          onClick={() => remove.mutate()}
        >
          Delete Account
        </Button>
      </div>
      {remove.isError && <p className="settings-error">{errorMessage(remove.error)}</p>}
    </ExpandRow>
  );
}
