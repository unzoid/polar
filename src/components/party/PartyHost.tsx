import { useEffect, useRef } from "react";
import { useAccount } from "../../lib/account/AccountProvider";
import { leaveParty, setJoinPartyOpen, useJoinPartyOpen, useParty } from "../../lib/party/party";
import { useRouter } from "../../lib/router";
import { Sheet } from "../Sheet";
import { JoinForm } from "./PartyUI";

/**
 * The watch party's place in navigation: goes wherever the room goes (joining,
 * someone putting on the next episode) and leaves the room when you leave the
 * player. Also hosts the "Join a Watch Party" sheet.
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
  const { profile } = useAccount();
  return (
    <Sheet
      open={open && !!profile}
      onClose={() => setJoinPartyOpen(false)}
      title="Join a Watch Party"
      subtitle="Enter the code a friend shared with you."
    >
      {profile && <JoinForm me={profile} onJoined={() => setJoinPartyOpen(false)} />}
    </Sheet>
  );
}
