import { useEffect, useState } from "react";
import { useAccount } from "../../lib/account";
import { friends, setFriendsOpen, useFriends, useWatching } from "../../lib/friends";
import { joinParty, useParty, usePartySurface } from "../../lib/party";
import { usePresence } from "../../lib/ui";
import { useTvMode } from "../../tv/tvMode";
import { Avatar } from "../Avatar";
import { Close } from "../icons";
import { Button, IconButton } from "../ui/Button";
import { TOAST_OUT_MS, Toast } from "../ui/Toast";
import { FriendsPanel } from "./FriendsPanel";

/**
 * Friends (#135) for the profile in use: starts the friends store on it (which reads from the
 * server whether the profile has Friends on), keeps what friends may see current (the party it's
 * in, what plays), and shows invites. The Friends panel is desktop's; TV lists friends on Home.
 */
export function FriendsHost() {
  const { status, profile } = useAccount();
  const id = status === "ready" ? (profile?.id ?? null) : null;
  useEffect(() => friends.start(id), [id]);
  // Signing out or switching profiles remounts the app: nothing shown or listened to meanwhile.
  useEffect(() => () => friends.start(null), []);

  const party = useParty();
  const code = party && !party.knocking && party.status === "live" ? party.code : null;
  const watching = useWatching();
  useEffect(() => friends.setShown({ party: code, watching }), [code, watching]);

  const tv = useTvMode();
  return (
    <>
      {!tv && <FriendsPanel />}
      <InviteToast tv={tv} />
    </>
  );
}

/**
 * The newest invite into a friend's party, until joined, dismissed or expired. Waits while a watch
 * party dialog or panel is up (the Friends panel lists invites itself). On TV it points to Home's
 * Friends row, where the invite is joined.
 */
function InviteToast({ tv }: { tv: boolean }) {
  const { invites } = useFriends();
  const { profile } = useAccount();
  const surface = usePartySurface();
  const invite = invites.at(-1) ?? null;
  const { shown, leaving } = usePresence(surface ? null : invite, TOAST_OUT_MS);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [invite?.id]);
  if (!shown) return null;
  const join = () => {
    if (!profile) return;
    joinParty(shown.party, profile).then(
      () => friends.dismissInvite(shown.id),
      (e: Error) => setError(e.message),
    );
    // While the host decides, the Friends panel says so (and closing it gives up).
    setFriendsOpen(true);
  };
  const actions = (
    <>
      <Button size="sm" variant="primary" className="toast-action" onClick={join}>
        Join
      </Button>
      <IconButton label="Dismiss" onClick={() => friends.dismissInvite(shown.id)}>
        <Close size={18} />
      </IconButton>
    </>
  );
  return (
    <Toast
      variant={tv ? "tv" : undefined}
      icon={<Avatar id={shown.avatar} className="toast-icon friends-toast-face" />}
      actions={!tv && actions}
      leaving={leaving}
      className="friends-toast"
      data-kind="friend-invite"
    >
      <strong>{shown.name} invited you to a watch party</strong>
      <span>{error ?? (tv ? "Join from Friends on Home." : "Join to watch together.")}</span>
    </Toast>
  );
}
