import { useMutation } from "@tanstack/react-query";
import { TextField } from "../../components/ui/TextField";
import { Edit, Trash } from "../../components/icons";
import { useState } from "react";
import { Avatar } from "../../components/Avatar";
import { useAccount } from "../../lib/account";
import { errorMessage } from "../../lib/errors";
import { Button } from "../../components/ui/Button";
import { ActionRow, Card, ExpandRow, LinkRow, RowText, useExpanded, type Expandable } from "../../components/settings/rows";

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
      <Card footer="Your library, watch history, playlists, settings, shortcuts and addons sync automatically. Volume and TV mode stay on this device.">
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

      <Card title="Danger Zone">
        <DeleteAccountRow {...expand("delete")} />
      </Card>
    </>
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
