import type { AccountBackend, PartyHandlers, PartyPresence, Profile } from "../../account/backend";
import { normalizeAvatar } from "../../account/avatars";

/**
 * A stand-in account for fake.html (`fake.html?account=1`): signed in, with one profile, and watch
 * party rooms that live in this page only (#247), so a browser test can start a party without a
 * server. Nothing is stored; sync rounds come back empty.
 */

type Member = { handlers: PartyHandlers; presence: PartyPresence };
const rooms = new Map<string, Set<Member>>();

/** Like a Realtime channel: never in the same task as the call. */
const soon = (fn: () => void) => void setTimeout(fn, 0);

function announce(room: Set<Member>) {
  const all = [...room].map((m) => m.presence);
  room.forEach((m) => soon(() => m.handlers.onPresence(all)));
}

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
