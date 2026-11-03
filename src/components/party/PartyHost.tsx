import { useEffect, useRef } from "react";
import { useAccount } from "../../lib/account/AccountProvider";
import { leaveParty, setJoinPartyOpen, useJoinPartyOpen, useParty } from "../../lib/party/party";
import { useRouter } from "../../lib/router";
import { Dialog } from "@base-ui/react/dialog";
import { Close, WatchParty } from "../icons";
import { JoinForm } from "./PartyUI";
import { useTvMode } from "../../tv/tvMode";

/**
 * The watch party's place in navigation: goes wherever the room goes (joining,
 * someone putting on the next episode) and leaves the room when you leave the
 * player. Also hosts the "Join a Watch Party" dialog.
 */
export function PartyHost() {
  const party = useParty();
  const { current, navigate, replace } = useRouter();
  const pb = party?.playback;

  // Only a new timeline moves you: your own episode change has already
  // navigated, and becomes the room's timeline once that player is up.
  useEffect(() => {
    if (!pb) return;
    const m = pb.media;
    if (current.name === "player" && current.videoId === m.videoId) return;
    const route = { name: "player", type: m.type, metaId: m.metaId, videoId: m.videoId } as const;
    if (current.name === "player") replace(route);
    else navigate(route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pb?.v, pb?.by]);

  // Leaving the player is leaving the party (the room carries on without you).
  const entered = useRef(false);
  const inPlayer = current.name === "player";
  useEffect(() => {
    if (!party) {
      entered.current = false;
      return;
    }
    if (inPlayer) entered.current = true;
    else if (entered.current) leaveParty();
  }, [party, inPlayer]);

  // Signing out or switching profiles remounts the app: that's leaving too.
  useEffect(() => () => leaveParty(), []);

  const open = useJoinPartyOpen();
  // TV mode asks on its own on-screen keyboard (TvJoinParty).
  const tv = useTvMode();
  const { profile } = useAccount();
  // A centred dialog: one short question, not a place you browse.
  return (
    <Dialog.Root open={open && !!profile && !tv} onOpenChange={(o) => !o && setJoinPartyOpen(false)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="party-dialog-scrim" />
        <Dialog.Popup className="party-dialog">
          <div className="party-dialog-icon" aria-hidden>
            <WatchParty size={22} />
          </div>
          <Dialog.Title className="party-dialog-title">Join a Watch Party</Dialog.Title>
          <Dialog.Description className="party-dialog-text">Enter the code a friend shared with you.</Dialog.Description>
          {profile && <JoinForm me={profile} onJoined={() => setJoinPartyOpen(false)} />}
          <Dialog.Close className="party-dialog-close pressable" aria-label="Close">
            <Close size={18} />
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
