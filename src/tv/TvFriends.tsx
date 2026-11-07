import { useState } from "react";
import { Avatar } from "../components/Avatar";
import { useAccount } from "../lib/account";
import { friendRank, friends, friendStatus, joiningText, useFriends } from "../lib/friends";
import { joinParty, useParty } from "../lib/party";
import { TvRail } from "./TvRails";

/**
 * TV Home's Friends row (#135), while the profile has Friends on and someone to show: invites
 * first, then friends in a party, watching, online, offline. OK on someone in a party joins it (the
 * player comes up once the host lets you in). Adding friends and answering requests happen on a
 * computer or phone, where there's a keyboard; the row says when requests are waiting.
 */
export function TvFriendsRail() {
  const state = useFriends();
  const party = useParty();
  const { profile } = useAccount();
  const [note, setNote] = useState<string | null>(null);
  const friendsList = state.entries
    .filter((e) => e.state === "accepted")
    .sort((a, b) => friendRank(state.presence[a.id]) - friendRank(state.presence[b.id]) || a.name.localeCompare(b.name));
  const requests = state.entries.filter((e) => e.state === "pending" && e.incoming).length;
  if (!state.settings || (!friendsList.length && !state.invites.length)) return null;

  const join = (code: string, invite?: number) => {
    if (!profile || party?.code === code) return;
    setNote(null);
    joinParty(code, profile).then(
      () => {
        setNote(null);
        if (invite !== undefined) friends.dismissInvite(invite);
      },
      (e: Error) => setNote(e.message),
    );
  };
  const waiting = joiningText(party);
  const notes = [waiting ?? note, requests ? `${requests} friend request${requests > 1 ? "s" : ""}: answer from Friends on a computer or phone` : null];

  return (
    <TvRail title="Friends" note={notes.filter(Boolean).join(" · ") || undefined}>
      {state.invites.map((i) => (
        <button key={`invite-${i.id}`} className="tv-friend" data-online onClick={() => join(i.party, i.id)}>
          <Avatar id={i.avatar} className="tv-friend-face" />
          <span className="tv-friend-who">
            <strong>{i.name}</strong>
            <span>Invited you · Join</span>
          </span>
        </button>
      ))}
      {friendsList.map((f) => {
        const p = state.presence[f.id];
        const theirs = p?.party;
        return (
          <button
            key={f.id}
            className="tv-friend"
            data-online={!!p || undefined}
            aria-disabled={!theirs || undefined}
            onClick={() => theirs && join(theirs)}
          >
            <Avatar id={f.avatar} className="tv-friend-face" />
            <span className="tv-friend-who">
              <strong>{f.name}</strong>
              <span>{friendStatus(p)}</span>
            </span>
          </button>
        );
      })}
    </TvRail>
  );
}
