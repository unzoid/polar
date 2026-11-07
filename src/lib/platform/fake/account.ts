import type { AccountBackend, PartyHandlers, PartyPresence, Profile } from "../../account/backend";
import { normalizeAvatar } from "../../account/avatars";

/**
 * A stand-in account for fake.html (`fake.html?account=1`): signed in, with one profile, and watch
 * party rooms without a server (#247), so a browser test can start a party. Rooms reach the other
 * fake pages of the same browser over a BroadcastChannel, so two pages can be two members (#154).
 * Nothing is stored; sync rounds come back empty.
 */

type Member = { key: string; handlers: PartyHandlers; presence: PartyPresence };
const rooms = new Map<string, Set<Member>>();
/** Other pages' members, by room and key. */
const remote = new Map<string, Map<string, PartyPresence>>();
const page = Math.random().toString(36).slice(2);
let nextMember = 0;

type BusMessage =
  | { code: string; kind: "m"; message: Record<string, unknown> }
  | { code: string; kind: "p"; key: string; presence: PartyPresence | null }
  | { code: string; kind: "who" };
const bus = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("polar-fake-party");

/** Like a Realtime channel: never in the same task as the call. */
const soon = (fn: () => void) => void setTimeout(fn, 0);

function announce(code: string) {
  const room = rooms.get(code);
  if (!room) return;
  const all = [...[...room].map((m) => m.presence), ...(remote.get(code)?.values() ?? [])];
  room.forEach((m) => soon(() => m.handlers.onPresence(all)));
}

const deliver = (code: string, message: Record<string, unknown>) => rooms.get(code)?.forEach((m) => soon(() => m.handlers.onMessage(message)));
const post = (m: BusMessage) => bus?.postMessage(m);

if (bus) {
  bus.onmessage = ({ data }: MessageEvent<BusMessage>) => {
    if (data.kind === "m") return deliver(data.code, data.message);
    if (data.kind === "who") return rooms.get(data.code)?.forEach((m) => post({ code: data.code, kind: "p", key: m.key, presence: m.presence }));
    const there = remote.get(data.code) ?? new Map<string, PartyPresence>();
    remote.set(data.code, there);
    if (data.presence) there.set(data.key, data.presence);
    else there.delete(data.key);
    announce(data.code);
  };
  // A page closed: its members are gone from the others' rooms.
  addEventListener("pagehide", () => rooms.forEach((room, code) => room.forEach((m) => post({ code, kind: "p", key: m.key, presence: null }))));
}

const profile: Profile = { id: "fake-profile", name: "Robin", avatar: normalizeAvatar(""), position: 0 };

export const fakeAccount: AccountBackend = {
  name: "fake",
  party: {
    connect(code, me, handlers) {
      const room = rooms.get(code) ?? new Set<Member>();
      rooms.set(code, room);
      const member: Member = { key: `${page}-${nextMember++}`, handlers, presence: me };
      room.add(member);
      soon(() => handlers.onStatus("joined"));
      post({ code, kind: "who" });
      post({ code, kind: "p", key: member.key, presence: me });
      announce(code);
      return {
        send: (message) => {
          deliver(code, message);
          post({ code, kind: "m", message });
        },
        track: (presence) => {
          member.presence = presence;
          post({ code, kind: "p", key: member.key, presence });
          announce(code);
        },
        reconnect: () => soon(() => handlers.onStatus("joined")),
        close: () => {
          room.delete(member);
          post({ code, kind: "p", key: member.key, presence: null });
          if (room.size) announce(code);
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
