/**
 * A profile's friends (#135): the list from the account server, who is online
 * and in which party (Realtime presence), invites, and this profile's own
 * presence as its privacy settings allow.
 *
 * Off until the profile turns Friends on (kept on the server, per profile): then
 * it has a friend code, listens to its friends and shows itself to them as its
 * settings allow. Turning it off takes the code away (nobody can send a
 * request with it) and stops both; friends stay.
 *
 * Written against `FriendsDeps` so tests run it with a fake server and clock
 * (tests/friendsStore.test.ts); `./index.ts` makes the app's one.
 */
import {
  AccountError,
  type AccountBackend,
  type FriendEntry,
  type FriendPresence,
  type FriendPrivacy,
  type FriendRequestResult,
  type FriendSettings,
} from "../account/backend";
import type { AvatarId } from "../account/avatars";
import { normalizeFriendCode, ownPresence, samePresence, FRIEND_CODE_LENGTH } from "./messages";

/**
 * Presence updates are rate-limited by the server, maybe per connection, which the watch party's
 * channel shares (#227: 5 in 30 s, the room keeping to 5 in 32 s): at most one this often, so
 * friends take 2 of every 30 s at most, and only when something changed.
 */
export const TRACK_MS = 15_000;
/** An invite not acted on goes away after this long. */
export const INVITE_MS = 120_000;
/** Invites shown at once; older ones make way. */
export const INVITES_MAX = 3;
/** Friends listened to at once (one Realtime channel each); the server allows 50 friends. */
export const FOLLOW_MAX = 50;
/** A "read the list again" from the server waits this long, so a burst reads it once. */
export const CHANGED_SETTLE_MS = 500;

export interface FriendInvite {
  id: number;
  from: string;
  name: string;
  avatar: AvatarId;
  party: string;
}

export interface FriendsState {
  profileId: string | null;
  /** The server has said whether Friends is on (false until then, and without a profile). */
  checked: boolean;
  /** Friends on: the code and what friends see; `null` while it's off. */
  settings: FriendSettings | null;
  entries: FriendEntry[];
  /** Friends online, by id: what each shows. */
  presence: Record<string, FriendPresence>;
  invites: FriendInvite[];
  /** The list has been read at least once since Friends came on. */
  loaded: boolean;
  /** Why the list or code couldn't be read. */
  error: string | null;
}

/** What this profile is doing; its settings decide what of it friends see. */
export interface OwnShown {
  party: string | null;
  watching: FriendPresence["watching"] | null;
}

export interface FriendsDeps {
  friends: () => AccountBackend["friends"] | null;
  now(): number;
  after(fn: () => void, ms: number): () => void;
}

const EMPTY: FriendsState = { profileId: null, checked: false, settings: null, entries: [], presence: {}, invites: [], loaded: false, error: null };
const IDLE: OwnShown = { party: null, watching: null };

const message = (e: unknown) => (e instanceof AccountError || e instanceof Error ? e.message : "Something went wrong.");

export function createFriends(deps: FriendsDeps) {
  let state: FriendsState = EMPTY;
  const listeners = new Set<() => void>();
  let link: ReturnType<AccountBackend["friends"]["connect"]> | null = null;
  /** Bumped by every start: answers for an earlier profile or setting are dropped. */
  let epoch = 0;
  let shown: OwnShown = IDLE;
  let sent: FriendPresence | null = null;
  let seq = 0;
  let lastTrack = -Infinity;
  let cancelTrack: (() => void) | null = null;
  let cancelChanged: (() => void) | null = null;
  const inviteTimers = new Map<number, () => void>();
  let inviteId = 0;

  const emit = () => listeners.forEach((l) => l());
  const set = (patch: Partial<FriendsState>) => {
    state = { ...state, ...patch };
    emit();
  };
  const api = () => {
    const f = deps.friends();
    if (!f || !state.profileId) throw new AccountError("not_set_up", "Friends need an account.");
    return { f, p: state.profileId };
  };

  function stop() {
    link?.close();
    link = null;
    cancelTrack?.();
    cancelTrack = null;
    cancelChanged?.();
    cancelChanged = null;
    inviteTimers.forEach((c) => c());
    inviteTimers.clear();
    sent = null;
  }

  /** The profile in use (`null`: none): reads whether it has Friends on, and if so starts. */
  function start(profileId: string | null) {
    if (profileId === state.profileId) return;
    stop();
    const mine = ++epoch;
    state = { ...EMPTY, profileId };
    emit();
    const f = deps.friends();
    if (!profileId || !f) return;
    f.settings(profileId).then(
      (settings) => {
        if (mine !== epoch) return;
        set({ checked: true, settings });
        if (settings) begin();
      },
      (e) => mine === epoch && set({ checked: true, error: message(e) }),
    );
  }

  /** Friends is on: listen, show this profile, read the list. */
  function begin() {
    const f = deps.friends();
    const p = state.profileId;
    if (!f || !p || link) return;
    const mine = epoch;
    link = f.connect(p, {
      onPresence: (id, presence) => mine === epoch && onPresence(id, presence),
      onInvite: (inv) => mine === epoch && onInvite(inv),
      onChanged: () => mine === epoch && changedSoon(),
    });
    track();
    void refresh();
  }

  /** Turn Friends on (a code, everything shown until changed) or off (the code goes; friends stay). */
  async function setOn(on: boolean) {
    const { f, p } = api();
    const mine = epoch;
    if (on) {
      const settings = await f.on(p);
      if (mine !== epoch) return;
      set({ settings, error: null });
      begin();
    } else {
      await f.off(p);
      if (mine !== epoch) return;
      stop();
      set({ settings: null, entries: [], presence: {}, invites: [], loaded: false });
    }
  }

  /** What friends see: shown at once here, then stored. */
  async function setPrivacy(patch: Partial<FriendPrivacy>) {
    const { f, p } = api();
    const before = state.settings;
    if (!before) throw new AccountError("friends_off", "Friends is off for this profile.");
    const next = { ...before, ...patch };
    set({ settings: next });
    track();
    try {
      await f.setPrivacy(p, { online: next.online, watching: next.watching, join: next.join });
    } catch (e) {
      if (state.settings === next) {
        set({ settings: before });
        track();
      }
      throw e;
    }
  }

  function onPresence(id: string, p: FriendPresence | null) {
    if (!state.entries.some((e) => e.id === id && e.state === "accepted")) return;
    const presence = { ...state.presence };
    if (p) presence[id] = p;
    else delete presence[id];
    set({ presence });
  }

  function onInvite({ from, party }: { from: string; party: string }) {
    const friend = state.entries.find((e) => e.id === from && e.state === "accepted");
    // From someone who isn't a friend (any more), into the party this profile is in, or said already.
    if (!friend || party === shown.party || state.invites.some((i) => i.from === from && i.party === party)) return;
    const invite: FriendInvite = { id: ++inviteId, from, name: friend.name, avatar: friend.avatar, party };
    const all = [...state.invites, invite];
    all.slice(0, -INVITES_MAX).forEach((old) => forgetTimer(old.id));
    inviteTimers.set(
      invite.id,
      deps.after(() => dismissInvite(invite.id), INVITE_MS),
    );
    set({ invites: all.slice(-INVITES_MAX) });
  }

  function forgetTimer(id: number) {
    inviteTimers.get(id)?.();
    inviteTimers.delete(id);
  }

  function dismissInvite(id: number) {
    forgetTimer(id);
    set({ invites: state.invites.filter((i) => i.id !== id) });
  }

  function changedSoon() {
    cancelChanged?.();
    cancelChanged = deps.after(() => {
      cancelChanged = null;
      void refresh();
    }, CHANGED_SETTLE_MS);
  }

  /** Read the list again; listens to whoever is a friend now. */
  async function refresh() {
    const f = deps.friends();
    const p = state.profileId;
    if (!f || !p || !state.settings) return;
    const mine = epoch;
    try {
      const entries = await f.list(p);
      if (mine !== epoch) return;
      const friends = entries.filter((e) => e.state === "accepted").map((e) => e.id);
      const presence = Object.fromEntries(Object.entries(state.presence).filter(([id]) => friends.includes(id)));
      set({ entries, presence, loaded: true, error: null });
      link?.follow(friends.slice(0, FOLLOW_MAX));
    } catch (e) {
      if (mine === epoch) set({ error: message(e), loaded: true });
    }
  }

  /** What this profile shows its friends: sent when it changes, within the server's rate. */
  function setShown(next: OwnShown) {
    shown = next;
    track();
  }

  function track() {
    if (!link || !state.profileId || !state.settings) return;
    const next = ownPresence(state.profileId, seq + 1, state.settings, shown.party, shown.watching);
    if (samePresence(next, sent)) {
      cancelTrack?.();
      cancelTrack = null;
      return;
    }
    const wait = lastTrack + TRACK_MS - deps.now();
    if (wait > 0) {
      cancelTrack ??= deps.after(() => {
        cancelTrack = null;
        track();
      }, wait);
      return;
    }
    seq += 1;
    sent = next;
    lastTrack = deps.now();
    link.track(next);
  }

  /** Mutations that change the list: done, then the list read again. */
  async function change<T>(run: (f: AccountBackend["friends"], p: string) => Promise<T>): Promise<T> {
    const { f, p } = api();
    const out = await run(f, p);
    await refresh();
    return out;
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    get: () => state,
    start,
    setShown,
    refresh,
    dismissInvite,
    /** Ask the profile with this code (typed, pasted or from a link). */
    add(input: string): Promise<FriendRequestResult> {
      const code = normalizeFriendCode(input);
      if (code.length !== FRIEND_CODE_LENGTH) return Promise.reject(new Error("Friend codes are 8 letters and numbers."));
      if (code === state.settings?.code) return Promise.reject(new AccountError("friend_self", "That's your own friend code."));
      return change((f, p) => f.request(p, code));
    },
    respond: (id: string, accept: boolean) => change((f, p) => f.respond(p, id, accept)),
    remove: (id: string) => change((f, p) => f.remove(p, id)),
    block: (id: string) => change((f, p) => f.block(p, id)),
    unblock: (id: string) => change((f, p) => f.unblock(p, id)),
    setOn,
    setPrivacy,
    async newCode() {
      const { f, p } = api();
      const mine = epoch;
      const code = await f.resetCode(p);
      if (mine === epoch && state.settings) set({ settings: { ...state.settings, code } });
      return code;
    },
    invite(id: string) {
      const { f, p } = api();
      if (!shown.party) return Promise.reject(new Error("Start or join a watch party first."));
      return f.invite(p, id, shown.party);
    },
  };
}

export type FriendsStore = ReturnType<typeof createFriends>;
