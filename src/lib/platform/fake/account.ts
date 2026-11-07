import { AccountError, type AccountBackend, type AccountUser, type FriendEntry, type FriendPresence, type FriendSettings, type FriendsHandlers, type PartyHandlers, type PartyPresence, type Profile } from "../../account/backend";
import { normalizeAvatar } from "../../account/avatars";
import { normalizeTvCode, type TvClaim } from "../../account/tvSignIn";

/**
 * A stand-in account for fake.html (`fake.html?account=1`): signed in, with one profile, and watch
 * party rooms without a server (#247), so a browser test can start a party. Rooms reach the other
 * fake pages of the same browser over a BroadcastChannel, so two pages can be two members (#154).
 * Nothing is stored; sync rounds come back empty.
 *
 * Friends (#135) live here too, off until turned on: Sam, a friend in a watch party on an open film, and Alex, who has sent
 * a request (online, watching nothing shown, once accepted). Any other code sends a request to Kai,
 * who doesn't answer. `__polarFakeFriendInvite()` has Sam invite this profile into Sam's party;
 * `fake.html?account=1&friends=1` starts with Friends on.
 *
 * `fake.html?account=signed-out` starts signed out, for the sign-in screens. Signing in on a TV
 * (#133) works in the page too: `__polarFakeTv.answer(true)` answers the code this page shows, and
 * `__polarFakeTv.waiting("Living room TV")` makes a code another device would show, for Settings →
 * Account → Sign in a TV to take.
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
const FRIENDS_ON: FriendSettings = { code: "FAKE2345", online: true, watching: true, join: true };
let friendSettings: FriendSettings | null = new URLSearchParams(location.search).get("friends") ? { ...FRIENDS_ON } : null;
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
const user: AccountUser = { id: "fake-user", email: "robin@example.com" };

let signedIn = true;
/** `fake.html?account=signed-out`. */
export const startSignedOut = () => void (signedIn = false);

type TvRequest = { code: string; poll: string; device: string; answer: TvClaim["state"] };
const tvRequests: TvRequest[] = [];
/** Codes in the server's letters, a new one each time. */
const tvCodes = ["HJKMNPQR", "STUVWXYZ", "ABCDEFGH", "23456789"];
const tvRequest = (device: string) => {
  const r: TvRequest = { code: tvCodes[tvRequests.length % tvCodes.length], poll: `poll-${tvRequests.length}`, device, answer: "pending" };
  tvRequests.push(r);
  return r;
};
const liveTvRequest = (code: string) => tvRequests.find((r) => r.code === normalizeTvCode(code) && r.answer === "pending");
const noTvCode = () => new AccountError("invalid_code", "That code is wrong or has expired. Check the code on the TV.");
Object.assign(globalThis, {
  __polarFakeTv: {
    /** Answers the newest code this page asked for, as the other device would. */
    answer: (approve: boolean) => {
      const r = tvRequests.findLast((x) => x.answer === "pending");
      if (r) r.answer = approve ? "approved" : "denied";
    },
    /** A code another device shows; returns it. */
    waiting: (device: string) => tvRequest(device).code,
    /** What happened to a code: "pending", "approved", "denied". */
    state: (code: string) => tvRequests.find((r) => r.code === normalizeTvCode(code))?.answer,
  },
});

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
  friends: {
    settings: async () => friendSettings && { ...friendSettings },
    on: async () => ({ ...(friendSettings ??= { ...FRIENDS_ON }) }),
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
    current: async () => (signedIn ? user : null),
    onChange: () => () => {},
    sendCode: async () => {},
    verifyCode: async () => ((signedIn = true), user),
    signOut: async () => void (signedIn = false),
    deleteAccount: async () => void (signedIn = false),
  },
  tvSignIn: {
    start: async (device) => {
      const r = tvRequest(device);
      return { code: r.code, poll: r.poll, expiresAt: Date.now() + 5 * 60_000 };
    },
    claim: async (poll) => {
      const r = tvRequests.find((x) => x.poll === poll);
      if (!r) return { state: "expired" };
      const state = r.answer;
      // An answer is handed out once.
      if (state !== "pending") r.answer = "expired";
      return state === "approved" ? { state, tokenHash: "TOKEN" } : { state };
    },
    finish: async () => ((signedIn = true), user),
    look: async (code) => liveTvRequest(code)?.device ?? Promise.reject(noTvCode()),
    answer: async (code, approve) => {
      const r = liveTvRequest(code);
      if (!r) throw noTvCode();
      r.answer = approve ? "approved" : "denied";
    },
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
