import { useState } from "react";
import type { FriendPrivacy } from "../../lib/account";
import { friends, friendsAvailable, setFriendsOpen, useFriends } from "../../lib/friends";
import { errorMessage } from "../../lib/errors";
import { closeSettings } from "../../lib/settings";
import { Users } from "../icons";
import { Dropdown } from "../Dropdown";
import { Card, LinkRow, PickRow, ToggleRow } from "../settings/rows";

type Who = "friends" | "nobody";
const WHO = [
  { value: "friends" as Who, label: "Friends" },
  { value: "nobody" as Who, label: "Nobody" },
];

/**
 * Settings → Account → Friends (#135): on or off for this profile, and what friends see. Kept on
 * the account server per profile (not in synced settings, which follow the device until a profile's
 * own arrive), so a profile that never turned Friends on is never shown to anyone.
 */
export function FriendsSettings() {
  const state = useFriends();
  const [error, setError] = useState<string | null>(null);
  if (!friendsAvailable() || !state.profileId) return null;
  const s = state.settings;
  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((e) => setError(errorMessage(e)));
  };
  const privacy = (patch: Partial<FriendPrivacy>) => run(friends.setPrivacy(patch));
  return (
    <Card title="Friends" footer={s ? "Your friend list and code are in the profile menu, under Friends." : undefined}>
      <ToggleRow
        setting="friendsEnabled"
        title="Friends"
        caption="A friend code to add friends with, and a list of who's online and in a watch party. For this profile only."
        checked={!!s}
        disabled={!state.checked}
        onChange={(on) => run(friends.setOn(on))}
      />
      {s && (
        <>
          <PickRow setting="friendsOnline" title="Who sees you're online" caption="Nobody: you look offline to friends, and they can't join your watch party from their list.">
            <Dropdown label="Who sees you're online" value={s.online ? "friends" : "nobody"} onChange={(v) => privacy({ online: v === "friends" })} options={WHO} />
          </PickRow>
          <PickRow setting="friendsWatching" title="Who sees what you watch">
            <Dropdown label="Who sees what you watch" value={s.watching ? "friends" : "nobody"} onChange={(v) => privacy({ watching: v === "friends" })} options={WHO} />
          </PickRow>
          <ToggleRow
            setting="friendsJoin"
            title="Friends can join your watch party"
            caption="From their friend list, even when they can't see what's on."
            checked={s.join && s.online}
            disabled={!s.online}
            onChange={(join) => privacy({ join })}
          />
          <LinkRow
            icon={Users}
            title="Friend list"
            onClick={() => {
              closeSettings();
              setFriendsOpen(true);
            }}
          />
        </>
      )}
      {(error ?? state.error) && <p className="settings-error">{error ?? state.error}</p>}
    </Card>
  );
}
