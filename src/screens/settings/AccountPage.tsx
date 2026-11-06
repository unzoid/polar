import { useMutation } from "@tanstack/react-query";
import { TextField } from "../../components/ui/TextField";
import { Edit, Lock, Trash } from "../../components/icons";
import { useEffect, useState } from "react";
import { useAddons, useSettings } from "../../lib/net";
import { Avatar } from "../../components/Avatar";
import { dismissNotice, exposedNames, noticeDue, removeSecretsPassphrase, SECRET_KEYS, secretsState, setSecretsPassphrase, sync, unlockSecrets, useAccount, useSettingsSyncProblem } from "../../lib/account";
import { takeWhereStored, useSecretsNote } from "../../components/settings/secretsNote";
import { useSecretsPlain } from "../../components/settings/KeyWarning";
import { errorMessage } from "../../lib/errors";
import { Button } from "../../components/ui/Button";
import { ActionRow, Card, ExpandRow, FormRow, LinkRow, RowText, useExpanded, type Expandable } from "../../components/settings/rows";
import { StremioImport } from "../../components/settings/StremioImport";
import { CopySetup } from "../../components/settings/CopySetup";
import { SettingRow } from "../../components/settings/SettingRow";

export function AccountPage() {
  const account = useAccount();
  const expand = useExpanded(() => (takeWhereStored() ? "secrets" : null));
  const settingsProblem = useSettingsSyncProblem();

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
      {account.profile && <ExposedNotice profileId={account.profile.id} onPassphrase={() => openSecrets(expand("secrets"))} />}

      <Card footer="Your library, where you are in each title, playlists, settings, shortcuts, API keys and add-ons sync automatically. Volume and TV mode stay on this device.">
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
        <SettingRow id="shareAddonsAndKeys" />
        {settingsProblem === "too_large" && (
          <p className="settings-error">This profile's settings are too large to sync. Add-on links take the most room: remove some to sync again.</p>
        )}
        {settingsProblem === "not_set_up" && (
          <p className="settings-error">
            Settings and addons can't sync: the account server isn't set up for them yet. They stay on this device; your library and history still sync.
          </p>
        )}
      </Card>

      <CopySetup />

      <StremioImport />

      <Card title="Danger Zone">
        <DeleteAccountRow {...expand("delete")} />
      </Card>
    </>
  );
}

/** Opens the "API keys and addons" row, where the passphrase is set. */
function openSecrets(row: Expandable) {
  if (!row.open) row.onToggle();
  else document.querySelector('[data-setting="secrets"]')?.scrollIntoView({ block: "nearest" });
}

/**
 * While a profile's keys or keyed add-on links sync without a passphrase (#195): said plainly at the
 * top of the page, with the way to encrypt them. Dismissed, it stays away until another one is added.
 */
function ExposedNotice({ profileId, onPassphrase }: { profileId: string; onPassphrase: () => void }) {
  const plain = useSecretsPlain();
  const { data: settings } = useSettings();
  const { data: addons } = useAddons();
  const [, setDismissed] = useState(0);
  if (!plain || !settings || !addons) return null;
  const exposed = exposedNames(
    Object.fromEntries(SECRET_KEYS.map((k) => [k, (settings as unknown as Record<string, unknown>)[k]])),
    addons.map((a) => ({ id: a.manifest.id, url: a.manifestUrl })),
  );
  if (!noticeDue(profileId, exposed)) return null;
  const keys = exposed.filter((n) => n.startsWith("key:")).length;
  const links = exposed.length - keys;
  const what = [keys && `${keys === 1 ? "an API key" : `${keys} API keys`}`, links && `${links === 1 ? "an add-on link" : `${links} add-on links`} with a key in it`]
    .filter(Boolean)
    .join(" and ");
  const one = exposed.length === 1;
  return (
    <section className="settings-group">
      <h2 className="settings-group-title">Keys Stored Unencrypted</h2>
      <div className="settings-key-warning" role="status" data-kind="notice">
        <p className="settings-expand-text">
          This profile has {what}. {one ? "It syncs" : "They sync"} to your account unencrypted: anyone with access to the account server could read{" "}
          {one ? "it" : "them"}, and use what {one ? "it opens" : "they open"}. Set a passphrase to encrypt {one ? "it" : "them"}.
        </p>
        <div className="settings-expand-form">
          <Button variant="primary" onClick={onPassphrase}>
            Set a Passphrase
          </Button>
          <Button variant="plain" onClick={() => (dismissNotice(profileId, exposed), setDismissed((n) => n + 1))}>
            Dismiss
          </Button>
        </div>
      </div>
    </section>
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
  // Opened from a warning or the notice: brought into view.
  useEffect(() => {
    if (props.open) document.querySelector('[data-setting="secrets"]')?.scrollIntoView({ block: "nearest" });
  }, [props.open]);
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
      setting="secrets"
      icon={Lock}
      title="API keys and addons"
      caption={state === "locked" ? "Encrypted with a passphrase this device doesn't have" : "Synced to your account"}
      value={state === "plain" ? "Not encrypted" : state === "sealed" ? "Encrypted" : "Locked"}
      {...props}
    >
      <p className="settings-expand-text">{note}</p>
      <WhereStored state={state} />
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

/** What's stored where (#195), for the warnings' link: on the account server, and on this device. */
function WhereStored({ state }: { state: "plain" | "sealed" | "locked" }) {
  return (
    <dl className="settings-where">
      <dt>On the account server</dt>
      <dd>
        {state === "plain"
          ? "Your API keys and add-on links as you typed them: protected by your sign-in, but readable by anyone with access to the server."
          : "Your API keys and add-on links, encrypted with your passphrase. The server can't read them."}
      </dd>
      <dt>On this device</dt>
      <dd>{DEVICE_STORE}</dd>
    </dl>
  );
}

const DEVICE_STORE =
  "Your API keys and add-on links are in Polarity's data file (polarity.json, in the app's data folder), readable by programs running under your user account.";

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
