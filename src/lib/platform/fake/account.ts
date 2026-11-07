import { AccountError, type AccountBackend, type AccountUser, type PartyHandlers, type PartyPresence, type Profile } from "../../account/backend";
import { normalizeAvatar } from "../../account/avatars";
import { normalizeTvCode, type TvClaim } from "../../account/tvSignIn";

/**
 * A stand-in account for fake.html (`fake.html?account=1`): signed in, with one profile, and watch
 * party rooms that live in this page only (#247), so a browser test can start a party without a
 * server. Nothing is stored; sync rounds come back empty.
 *
 * `fake.html?account=signed-out` starts signed out, for the sign-in screens. Signing in on a TV
 * (#133) works in the page too: `__polarFakeTv.answer(true)` answers the code this page shows, and
 * `__polarFakeTv.waiting("Living room TV")` makes a code another device would show, for Settings →
 * Account → Sign in a TV to take.
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
