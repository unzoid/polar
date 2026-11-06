import { useEffect, useRef } from "react";
import { useAccount } from "../../lib/account";
import { dismissExit, getParty, leaveParty, setJoinPartyOpen, useJoinPartyOpen, useParty, usePartyExit } from "../../lib/party";
import { useRouter } from "../../lib/router";
import { Dialog } from "@base-ui/react/dialog";
import { Close, WatchParty } from "../icons";
import { Button, iconButtonClass } from "../ui/Button";
import { JoinForm, PartyNotes } from "./PartyUI";
import { useTvMode } from "../../tv/tvMode";

/**
 * The watch party's place in navigation: goes wherever the room goes (joining,
 * someone putting on something new). Leaving the player keeps you in the
 * room, browsing, so a party can go on from show to show; Leave Party (in the
 * player's party panel) is what leaves. Also hosts the "Join a Watch Party"
 * dialog, and the room's notes while you're out of the player.
 */
export function PartyHost() {
  const party = useParty();
  const { current, navigate, replace } = useRouter();
  const videoId = party?.playback?.media.videoId;

  // Only something new on the room moves you: pausing or seeking while you
  // browse doesn't, and your own pick has already navigated (it becomes the
  // room's once that player is up).
  const followed = useRef<string | null>(null);
  useEffect(() => {
    const m = party?.playback?.media;
    // Not let in yet: the room's video isn't ours to follow.
    if (!m || party.knocking) {
      followed.current = null;
      return;
    }
    if (followed.current === m.videoId) return;
    followed.current = m.videoId;
    if (current.name === "player" && current.videoId === m.videoId) return;
    const route = { name: "player", type: m.type, metaId: m.metaId, videoId: m.videoId } as const;
    if (current.name === "player") replace(route);
    else navigate(route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, party?.knocking]);

  // Signing out or switching profiles remounts the app: that's leaving.
  useEffect(() => () => leaveParty(), []);

  const open = useJoinPartyOpen();
  const exit = usePartyExit();
  // TV mode asks on its own on-screen keyboard (TvJoinParty).
  const tv = useTvMode();
  const { profile } = useAccount();
  const inPlayer = current.name === "player";
  // A centred dialog: one short question, not a place you browse.
  return (
    <>
      {party && !inPlayer && (
        <div className="party-float">
          <PartyNotes party={party} />
        </div>
      )}
      <Dialog.Root
        open={open && !!profile && !tv}
        onOpenChange={(o) => {
          if (o) return;
          // Closed while waiting for the host: that's giving up on joining.
          if (getParty()?.knocking) leaveParty();
          setJoinPartyOpen(false);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="party-dialog-scrim" />
          <Dialog.Popup className="party-dialog">
            <div className="party-dialog-icon" aria-hidden>
              <WatchParty size={22} />
            </div>
            <Dialog.Title className="party-dialog-title">Join a Watch Party</Dialog.Title>
            <Dialog.Description className="party-dialog-text">Enter the code a friend shared with you.</Dialog.Description>
            {profile && <JoinForm me={profile} onJoined={() => setJoinPartyOpen(false)} />}
            <Dialog.Close className={iconButtonClass("party")} aria-label="Close">
              <Close size={18} />
            </Dialog.Close>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {/* Removed, or the host ended it: said once, until read. */}
      <Dialog.Root open={!!exit} onOpenChange={(o) => !o && dismissExit()}>
        <Dialog.Portal>
          <Dialog.Backdrop className="party-dialog-scrim" />
          <Dialog.Popup className="party-dialog">
            <div className="party-dialog-icon" aria-hidden>
              <WatchParty size={22} />
            </div>
            <Dialog.Title className="party-dialog-title">Watch party over</Dialog.Title>
            <Dialog.Description className="party-dialog-text">{exit?.text}</Dialog.Description>
            <Dialog.Close render={<Button variant="primary" className="party-dialog-ok" autoFocus />}>OK</Dialog.Close>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
