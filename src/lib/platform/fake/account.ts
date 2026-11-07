import type { AccountBackend, FriendEntry, FriendPresence, FriendSettings, FriendsHandlers, PartyHandlers, PartyPresence, Profile } from "../../account/backend";
import { normalizeAvatar } from "../../account/avatars";

/**
 * A stand-in account for fake.html (`fake.html?account=1`): signed in, with one profile, and watch
 * party rooms that live in this page only (#247), so a browser test can start a party without a
 * server. Nothing is stored; sync rounds come back empty.
 *
 * Friends (#135) live here too, off until turned on: Sam, a friend in a watch party on an open film, and Alex, who has sent
 * a request (online, watching nothing shown, once accepted). Any other code sends a request to Kai,
 * who doesn't answer. `__polarFakeFriendInvite()` has Sam invite this profile into Sam's party.
 */

type Member = { handlers: PartyHandlers; presence: PartyPresence };
const rooms = new Map<string, Set<Member>>();

/** Like a Realtime channel: never in the same task as the call. */
const soon = (fn: () => void) => void setTimeout(fn, 0);

function announce(room: Set<Member>) {
  const all = [...room].map((m) => m.presence);
  room.forEach((m) => soon(() => m.handlers.onPresence(all)));
}

const SAM = "00000000-0000-4000-8000-00000000005a";
const ALEX = "00000000-0000-4000-8000-0000000000a1";
const KAI = "00000000-0000-4000-8000-0000000000ca";
const SAM_PARTY = "SAMPTY";
const people: Record<string, Omit<FriendEntry, "state" | "incoming">> = {
  [SAM]: { id: SAM, name: "Sam", avatar: normalizeAvatar("lagoon") },
  [ALEX]: { id: ALEX, name: "Alex", avatar: normalizeAvatar("coral") },
  [KAI]: { id: KAI, name: "Kai", avatar: normalizeAvatar("dusk") },
};
const online: Record<string, FriendPresence> = {
  [SAM]: { id: SAM, seq: 1, party: SAM_PARTY, watching: { type: "movie", metaId: "tt0000001", title: "Big Buck Bunny" } },
  [ALEX]: { id: ALEX, seq: 1 },
};
let friendSettings: FriendSettings | null = null;
let friendList: FriendEntry[] = [
  { ...people[SAM], state: "accepted", incoming: false },
  { ...people[ALEX], state: "pending", incoming: true },
];
let friendHandlers: FriendsHandlers | null = null;
const setState = (id: string, patch: Partial<FriendEntry> | null) => {
  friendList = patch ? friendList.map((f) => (f.id === id ? { ...f, ...patch } : f)) : friendList.filter((f) => f.id !== id);
};
(globalThis as { __polarFakeFriendInvite?: () => void }).__polarFakeFriendInvite = () =>
  soon(() => friendHandlers?.onInvite({ from: SAM, party: SAM_PARTY }));

const profile: Profile = { id: "fake-profile", name: "Robin", avatar: normalizeAvatar(""), position: 0 };

export const fakeAccount: AccountBackend = {
  name: "fake",
  party: {
    connect(code, me, handlers) {
      const room = rooms.get(code) ?? new Set<Member>();
      rooms.set(code, room);
      const member: Member = { handlers, presence: me };
      room.add(member);
      soon(() => handlers.onStatus("joined"));
      announce(room);
      return {
        send: (message) => room.forEach((m) => soon(() => m.handlers.onMessage(message))),
        track: (presence) => {
          member.presence = presence;
          announce(room);
        },
        reconnect: () => soon(() => handlers.onStatus("joined")),
        close: () => {
          room.delete(member);
          if (room.size) announce(room);
          else rooms.delete(code);
        },
      };
    },
  },
  friends: {
    settings: async () => friendSettings && { ...friendSettings },
    on: async () => ({ ...(friendSettings ??= { code: "FAKE2345", online: true, watching: true, join: true }) }),
    off: async () => void (friendSettings = null),
    resetCode: async () => (friendSettings ? (friendSettings.code = "NEWC2345") : ""),
    setPrivacy: async (_p, v) => void (friendSettings &&= { ...friendSettings, ...v }),
    list: async () => friendList.map((f) => ({ ...f })),
    request: async (_p, code) => {
      if (code === friendSettings?.code) return "already";
      if (friendList.some((f) => f.id === KAI)) return "already";
      friendList = [...friendList, { ...people[KAI], state: "pending", incoming: false }];
      return "sent";
    },
    respond: async (_p, other, accept) => setState(other, accept ? { state: "accepted" } : null),
    remove: async (_p, other) => setState(other, null),
    block: async (_p, other) => setState(other, { state: "blocked" }),
    unblock: async (_p, other) => setState(other, null),
    invite: async () => {},
    connect(_profileId, handlers) {
      friendHandlers = handlers;
      let followed: string[] = [];
      return {
        track: () => {},
        follow: (ids) => {
          followed = ids;
          for (const id of ids) if (online[id]) soon(() => followed.includes(id) && handlers.onPresence(id, online[id]));
        },
        close: () => {
          if (friendHandlers === handlers) friendHandlers = null;
        },
      };
    },
  },
  auth: {
    current: async () => ({ id: "fake-user", email: "robin@example.com" }),
    onChange: () => () => {},
    sendCode: async () => {},
    verifyCode: async () => ({ id: "fake-user", email: "robin@example.com" }),
    signOut: async () => {},
    deleteAccount: async () => {},
  },
  profiles: {
    list: async () => [profile],
    create: async (input) => ({ ...profile, ...input }),
    update: async (_id, patch) => ({ ...profile, ...patch }),
    remove: async () => {},
  },
  sync: {
    pull: async () => ({ library: [], progress: [], links: [], cursor: null }),
    push: async () => ({ links: true, unsent: [] }),
  },
  settings: {
    get: async () => null,
    put: async (_id, s) => s.updatedAt,
  },
  playlists: {
    pull: async () => ({ playlists: [], cursor: null }),
    push: async () => {},
  },
};
