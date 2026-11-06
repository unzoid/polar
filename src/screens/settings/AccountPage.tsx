import { useMutation } from "@tanstack/react-query";
import { TextField } from "../../components/ui/TextField";
import { Edit, Lock, Trash } from "../../components/icons";
import { useState } from "react";
import { Avatar } from "../../components/Avatar";
import { hasSecretsPassphrase, secretsLocked, setSecretsPassphrase, settingsTooLarge, sync, useAccount } from "../../lib/account";
import { setPrefs, usePrefs } from "../../lib/settings";
import { errorMessage } from "../../lib/errors";
import { Button } from "../../components/ui/Button";
import { ActionRow, Card, ExpandRow, FormRow, LinkRow, RowText, useExpanded, type Expandable } from "../../components/settings/rows";

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
          <p className="settings-error">This profile's settings are too large to sync. Sealed add-on links take the most room: remove some to sync again.</p>
        )}
      </Card>

      <Card title="Danger Zone">
        <DeleteAccountRow {...expand("delete")} />
      </Card>
    </>
  );
}

/**
 * API keys and add-on links sealed with a passphrase (account/secrets.ts), off unless turned on
 * here. The passphrase stays on this device; each device types it once.
 */
function SecretsRow({ profileId, ...props }: Expandable & { profileId: string }) {
  const { syncSecrets } = usePrefs();
  const [phrase, setPhrase] = useState("");
  const [, rerender] = useState(0);
  const set = hasSecretsPassphrase(profileId);
  const change = (fn: () => void) => {
    fn();
    rerender((n) => n + 1);
    sync.schedule();
  };
  return (
    <ExpandRow
      icon={Lock}
      title="Sync API keys and addons"
      caption="Encrypted with a passphrase only your devices know"
      value={syncSecrets ? "On" : "Off"}
      {...props}
    >
      <p className="settings-expand-text">
        Off: keys and addons stay on this device, and a new device asks for them again. On: they travel encrypted; type the same passphrase on
        each device. Without it nobody, the server included, can read them, and nobody can get them back if it's forgotten.
      </p>
      <div className="settings-expand-form">
        <Button variant={syncSecrets ? "danger" : "primary"} onClick={() => change(() => setPrefs({ syncSecrets: !syncSecrets }))}>
          {syncSecrets ? "Turn Off" : "Turn On"}
        </Button>
      </div>
      {syncSecrets && (
        <FormRow
          look="expand"
          type="password"
          placeholder={set ? "Passphrase set: type a new one to change it" : "Passphrase"}
          autoComplete="new-password"
          value={phrase}
          onChange={setPhrase}
          tidy={(v) => v}
          onSubmit={(v) => change(() => (setSecretsPassphrase(profileId, v), setPhrase("")))}
        />
      )}
      {syncSecrets && secretsLocked && <p className="settings-error">The account's keys were sealed with another passphrase.</p>}
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
