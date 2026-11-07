// The friends store (src/lib/friends/friends.ts, #135) against a fake server and clock: off until
// turned on, what this profile shows as its settings change (within the presence rate), friends'
// presence, invites, and nothing carried over from another profile.
import { beforeEach, expect, test } from "bun:test";
import { createFriends, CHANGED_SETTLE_MS, INVITE_MS, INVITES_MAX, TRACK_MS } from "../src/lib/friends/friends";
import type { AccountBackend, FriendEntry, FriendPresence, FriendSettings, FriendsHandlers } from "../src/lib/account/backend";

const ME = "00000000-0000-4000-8000-000000000001";
const OTHER_PROFILE = "00000000-0000-4000-8000-000000000002";
const SAM = "00000000-0000-4000-8000-00000000005a";
const ALEX = "00000000-0000-4000-8000-0000000000a1";
const watching = { type: "movie" as const, metaId: "tt0000001", title: "The Lantern and the Key" };

let now = 0;
let timers: { at: number; fn: () => void; live: boolean }[] = [];
const advance = async (ms: number) => {
  const end = now + ms;
  for (;;) {
    const next = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!next) break;
    now = next.at;
    next.live = false;
    next.fn();
    await flush();
  }
  now = end;
};
const flush = () => new Promise((r) => setTimeout(r, 0));

/** The fake server: one settings row per profile, the list, and what was tracked, followed and called. */
let settings: Record<string, FriendSettings | null>;
let list: FriendEntry[];
let tracked: (FriendPresence | null)[];
let followed: string[][];
let calls: string[];
let handlers: FriendsHandlers | null;
let closed: number;

const server: AccountBackend["friends"] = {
  settings: async (p) => settings[p] ?? null,
  on: async (p) => (settings[p] ??= { code: "ABCD2345", online: true, watching: true, join: true }),
  off: async (p) => {
    calls.push(`off ${p}`);
    settings[p] = null;
  },
  resetCode: async () => "WXYZ6789",
  setPrivacy: async (p, v) => {
    calls.push(`privacy ${JSON.stringify(v)}`);
    settings[p] = { ...settings[p]!, ...v };
  },
  list: async () => list.map((e) => ({ ...e })),
  request: async (_p, code) => {
    calls.push(`request ${code}`);
    return "sent";
  },
  respond: async (_p, id, accept) => void calls.push(`respond ${id} ${accept}`),
  remove: async (_p, id) => void calls.push(`remove ${id}`),
  block: async (_p, id) => void calls.push(`block ${id}`),
  unblock: async (_p, id) => void calls.push(`unblock ${id}`),
  invite: async (_p, id, party) => void calls.push(`invite ${id} ${party}`),
  connect(_p, h) {
    handlers = h;
    return {
      track: (p) => void tracked.push(p),
      follow: (ids) => void followed.push(ids),
      close: () => void (closed += 1),
    };
  },
};

const make = () =>
  createFriends({
    friends: () => server,
    now: () => now,
    after(fn, ms) {
      const t = { at: now + ms, fn, live: true };
      timers.push(t);
      return () => void (t.live = false);
    },
  });

beforeEach(() => {
  now = 1_000_000;
  timers = [];
  settings = {};
  list = [
    { id: SAM, name: "Sam", avatar: "lagoon", state: "accepted", incoming: false },
    { id: ALEX, name: "Alex", avatar: "coral", state: "pending", incoming: true },
  ];
  tracked = [];
  followed = [];
  calls = [];
  handlers = null;
  closed = 0;
});

test("off until the profile turns it on: nothing shown, nobody listened to", async () => {
  const f = make();
  f.start(ME);
  await flush();
  expect(f.get()).toMatchObject({ profileId: ME, checked: true, settings: null });
  expect(handlers).toBeNull();
  expect(tracked).toEqual([]);
  // Opening the panel while off reads nothing.
  await f.refresh();
  expect(f.get().entries).toEqual([]);
});

test("turned on: a code, the list, friends listened to, this profile shown", async () => {
  const f = make();
  f.start(ME);
  await flush();
  await f.setOn(true);
  await flush();
  expect(f.get().settings?.code).toBe("ABCD2345");
  expect(f.get().entries.map((e) => e.name)).toEqual(["Sam", "Alex"]);
  // Only accepted friends are listened to.
  expect(followed.at(-1)).toEqual([SAM]);
  expect(tracked).toEqual([{ id: ME, seq: 1 }]);
});

test("on already (another device turned it on): starts by itself", async () => {
  settings[ME] = { code: "ABCD2345", online: true, watching: true, join: true };
  const f = make();
  f.start(ME);
  await flush();
  await flush();
  expect(handlers).not.toBeNull();
  expect(followed.at(-1)).toEqual([SAM]);
});

test("what this profile shows follows its settings, at most once per presence window", async () => {
  settings[ME] = { code: "ABCD2345", online: true, watching: true, join: true };
  const f = make();
  f.start(ME);
  await flush();
  await flush();
  expect(tracked).toEqual([{ id: ME, seq: 1 }]);
  f.setShown({ party: "ABC123", watching });
  // Too soon after the last update: waits for the window.
  expect(tracked).toHaveLength(1);
  await advance(TRACK_MS);
  expect(tracked.at(-1)).toEqual({ id: ME, seq: 2, party: "ABC123", watching });
  // Hiding what's on: still joinable.
  await f.setPrivacy({ watching: false });
  await advance(TRACK_MS);
  expect(tracked.at(-1)).toEqual({ id: ME, seq: 3, party: "ABC123" });
  expect(calls).toContain(`privacy ${JSON.stringify({ online: true, watching: false, join: true })}`);
  // Nobody sees it's online: nothing at all.
  await f.setPrivacy({ online: false });
  await advance(TRACK_MS);
  expect(tracked.at(-1)).toBeNull();
  // Same again: nothing sent.
  const n = tracked.length;
  f.setShown({ party: "ABC123", watching });
  await advance(TRACK_MS * 2);
  expect(tracked).toHaveLength(n);
});

test("a setting the server refuses goes back to what it was", async () => {
  settings[ME] = { code: "ABCD2345", online: true, watching: true, join: true };
  const f = make();
  f.start(ME);
  await flush();
  await flush();
  const setPrivacy = server.setPrivacy;
  server.setPrivacy = async () => {
    throw new Error("offline");
  };
  try {
    await expect(f.setPrivacy({ watching: false })).rejects.toThrow("offline");
    expect(f.get().settings?.watching).toBe(true);
  } finally {
    server.setPrivacy = setPrivacy;
  }
});

test("friends' presence: only accepted friends, gone when they go offline", async () => {
  settings[ME] = { code: "ABCD2345", online: true, watching: true, join: true };
  const f = make();
  f.start(ME);
  await flush();
  await flush();
  handlers!.onPresence(SAM, { id: SAM, seq: 1, party: "SAMPTY" });
  handlers!.onPresence(ALEX, { id: ALEX, seq: 1 });
  expect(Object.keys(f.get().presence)).toEqual([SAM]);
  handlers!.onPresence(SAM, null);
  expect(f.get().presence).toEqual({});
});

test("invites: from friends only, once each, not into the party already joined, and they expire", async () => {
  settings[ME] = { code: "ABCD2345", online: true, watching: true, join: true };
  const f = make();
  f.start(ME);
  await flush();
  await flush();
  handlers!.onInvite({ from: ALEX, party: "ALXPTY" });
  expect(f.get().invites).toEqual([]);
  handlers!.onInvite({ from: SAM, party: "SAMPTY" });
  handlers!.onInvite({ from: SAM, party: "SAMPTY" });
  expect(f.get().invites).toMatchObject([{ from: SAM, name: "Sam", party: "SAMPTY" }]);
  f.setShown({ party: "OWNPTY", watching: null });
  handlers!.onInvite({ from: SAM, party: "OWNPTY" });
  expect(f.get().invites).toHaveLength(1);
  for (const p of ["AAA111", "BBB222", "CCC333"]) handlers!.onInvite({ from: SAM, party: p });
  expect(f.get().invites.map((i) => i.party)).toEqual(["AAA111", "BBB222", "CCC333"].slice(-INVITES_MAX));
  await advance(INVITE_MS);
  expect(f.get().invites).toEqual([]);
});

test("a change on the server reads the list again, once for a burst", async () => {
  settings[ME] = { code: "ABCD2345", online: true, watching: true, join: true };
  const f = make();
  f.start(ME);
  await flush();
  await flush();
  const before = followed.length;
  list = [...list.slice(0, 1), { ...list[1], state: "accepted" }];
  handlers!.onChanged();
  handlers!.onChanged();
  await advance(CHANGED_SETTLE_MS);
  await flush();
  expect(followed.length).toBe(before + 1);
  expect(followed.at(-1)).toEqual([SAM, ALEX]);
});

test("adding by code: typed any way, never this profile's own; then the list is read again", async () => {
  settings[ME] = { code: "ABCD2345", online: true, watching: true, join: true };
  const f = make();
  f.start(ME);
  await flush();
  await flush();
  expect(await f.add("wxyz-6789")).toBe("sent");
  expect(calls).toContain("request WXYZ6789");
  await expect(f.add("abcd 2345")).rejects.toThrow("your own friend code");
  await expect(f.add("ABC")).rejects.toThrow("8 letters and numbers");
  // Inviting needs a party.
  await expect(f.invite(SAM)).rejects.toThrow("watch party first");
  f.setShown({ party: "OWNPTY", watching: null });
  await f.invite(SAM);
  expect(calls).toContain(`invite ${SAM} OWNPTY`);
});

test("turned off: the code goes on the server, nothing is shown or listened to any more", async () => {
  settings[ME] = { code: "ABCD2345", online: true, watching: true, join: true };
  const f = make();
  f.start(ME);
  await flush();
  await flush();
  await f.setOn(false);
  expect(calls).toContain(`off ${ME}`);
  expect(closed).toBe(1);
  expect(f.get()).toMatchObject({ settings: null, entries: [], presence: {} });
});

test("another profile starts from nothing: its own settings, none of the last one's friends", async () => {
  settings[ME] = { code: "ABCD2345", online: true, watching: true, join: true };
  const f = make();
  f.start(ME);
  await flush();
  await flush();
  handlers!.onPresence(SAM, { id: SAM, seq: 1 });
  f.start(OTHER_PROFILE);
  expect(closed).toBe(1);
  await flush();
  expect(f.get()).toMatchObject({ profileId: OTHER_PROFILE, settings: null, entries: [], presence: {} });
  // A late answer for the first profile changes nothing.
  const late = handlers!;
  late.onPresence(SAM, { id: SAM, seq: 2 });
  expect(f.get().presence).toEqual({});
});
