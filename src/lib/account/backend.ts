/**
 * The contract every account provider implements. The app only ever talks to
 * this interface (via `./index.ts`); swapping Supabase for a self-hosted
 * server, PocketBase, etc. means writing one new file like `./supabase.ts`.
 */
import type { AnimeLink } from "../library/identity";
import type { ContentType, Progress, SyncLibraryItem } from "../types";
import { count, isRecord, str } from "../parse";
import { normalizeAvatar, type AvatarId } from "./avatars";

export interface AccountUser {
  id: string;
  email: string;
}

export interface Profile {
  id: string;
  name: string;
  avatar: AvatarId;
  position: number;
}

export type ProfileInput = Pick<Profile, "name" | "avatar">;

/** A profile row or this device's cached copy; `undefined` without an id (critique M9). */
export function readProfile(v: unknown): Profile | undefined {
  const id = isRecord(v) ? str(v.id) : undefined;
  if (!isRecord(v) || !id) return;
  return { id, name: str(v.name) ?? "", avatar: normalizeAvatar(str(v.avatar) ?? ""), position: count(v.position) ?? 0 };
}

export type AccountErrorCode =
  | "invalid_email"
  | "invalid_code"
  | "rate_limited"
  | "captcha_needed"
  | "profile_limit"
  | "playlist_limit"
  | "library_limit"
  | "progress_limit"
  | "anime_links_limit"
  | "settings_too_large"
  | "friends_off"
  | "friend_code_unknown"
  | "friend_self"
  | "friend_limit"
  | "friend_requests_limit"
  | "friend_tries_limit"
  | "friend_invite_limit"
  | "not_set_up"
  | "network"
  | "unknown";

/** Providers translate their own errors into these, so the UI stays generic. */
export class AccountError extends Error {
  constructor(
    public code: AccountErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** What `sync.push` stored; `full` names the kinds refused for want of room, with the error. */
export interface PushResult {
  links: boolean;
  unsent: string[];
  full?: { kinds: (keyof SyncChanges)[]; error: AccountError };
}

/** The account has no room left for a kind of row (#110): the user is told; nothing else stops. */
export const isLimit = (e: unknown): e is AccountError =>
  e instanceof AccountError && ["library_limit", "progress_limit", "anime_links_limit", "playlist_limit"].includes(e.code);

export interface PulledChanges {
  library: SyncLibraryItem[];
  progress: Progress[];
  /** `null`: the server can't store anime links yet (an older schema); library and progress still sync. */
  links: AnimeLink[] | null;
  /** Opaque cursor; hand it back to the next `pull`. */
  cursor: string | null;
}

export interface SyncChanges {
  library: SyncLibraryItem[];
  progress: Progress[];
  links: AnimeLink[];
}

export interface RemotePlaylist {
  id: string;
  name: string;
  items: Uint8Array;
  deleted: boolean;
  updatedAt: number;
}

export interface RemoteSettings {
  data: Record<string, unknown>;
  updatedAt: number;
}

/** One member as the room sees them (watch parties). */
export interface PartyPresence {
  id: string;
  name: string;
  avatar: string;
  /** Local clock of the member when they joined; only used to agree on an order. */
  joinedAt: number;
  /** Loading or buffering: the room holds until they catch up. */
  waiting: boolean;
  /** Out of the player, browsing for what's next: still in the room, but it doesn't wait for them. */
  away?: boolean;
  /** Stalled mid-video: shown, not waited for. */
  buffering?: boolean;
  /** Just joined, not yet let in by the host: not shown as a member, not listened to (#156). */
  knock?: boolean;
  /** Counts up with each update this member sends, so the newest entry wins when presence holds more than one. */
  seq?: number;
}

/** A live watch-party room: small messages to everyone in it, and who's there. */
export interface PartyLink {
  /** To everyone in the room, this member included (the echo times the round trip). */
  send(message: Record<string, unknown>): void;
  /** Update how this member appears to the others. */
  track(presence: PartyPresence): void;
  /** Drop this connection and open a new one: it stopped carrying messages without saying so. */
  reconnect(): void;
  close(): void;
}

export interface PartyHandlers {
  onMessage(message: Record<string, unknown>): void;
  onPresence(members: PartyPresence[]): void;
  /**
   * `joined` again after a reconnect (the room then sends its entry: joining
   * doesn't); `error` when the room can't be reached.
   * `setup`: the server refused the room itself (not configured for parties),
   * so retrying won't help. `closed`: the server closed the channel (too many
   * presence updates, #227): nothing arrives, and nothing reopens it, until
   * `reconnect()`.
   */
  onStatus(status: "joined" | "error" | "closed", detail?: { setup: boolean; message: string }): void;
}

/** A friend, a request either way or a block of this profile's (#135), as the server lists them. */
export interface FriendEntry {
  id: string;
  name: string;
  avatar: AvatarId;
  state: "pending" | "accepted" | "blocked";
  /** The other profile asked (for a block: the one blocked had asked). */
  incoming: boolean;
}

/** What a profile's friends see (Settings → Account → Friends), kept on the server per profile. */
export interface FriendPrivacy {
  /** Off: nothing at all, as if offline (and so not joinable from the list either). */
  online: boolean;
  watching: boolean;
  /** Friends may join its watch party from their list, even when they can't see what's on. */
  join: boolean;
}

export interface FriendSettings extends FriendPrivacy {
  code: string;
}

/** How `friends.request` went: asked, friends at once (they had asked first), nothing new, or blocked by this profile. */
export type FriendRequestResult = "sent" | "accepted" | "already" | "blocked";

/** What a profile shows its friends while online: only what its privacy settings allow (lib/friends/messages.ts). */
export interface FriendPresence {
  id: string;
  /** Counts up with each update, so the newest entry wins when presence holds more than one. */
  seq: number;
  /** The watch party it is in, when friends may join it. */
  party?: string;
  /** What is on, when friends may see it. */
  watching?: { type: ContentType; metaId: string; title: string; label?: string };
}

export interface FriendsHandlers {
  /** A friend's presence: `null` when they are offline (or show nobody that they're online). */
  onPresence(friendId: string, presence: FriendPresence | null): void;
  /** A friend invites this profile into their watch party; `from` is filled in by the server. */
  onInvite(invite: { from: string; party: string }): void;
  /** The list changed on the server (a request, an answer, a removal): read it again. */
  onChanged(): void;
}

export interface FriendsLink {
  /** Show this profile as online, with what it allows; `null`: not shown at all. */
  track(presence: FriendPresence | null): void;
  /** Listen to these friends (and stop listening to anyone else). */
  follow(friendIds: string[]): void;
  close(): void;
}

export interface AccountBackend {
  readonly name: string;

  /** Realtime rooms for watching together. Signed-in users only. */
  party: {
    connect(code: string, me: PartyPresence, handlers: PartyHandlers): PartyLink;
  };

  /** Friends of a profile (#135): codes, requests, blocks, invites and presence. Signed-in users only. */
  friends: {
    /** The profile's code and what its friends see; `null` while Friends is off (as it starts). */
    settings(profileId: string): Promise<FriendSettings | null>;
    /** Friends on: a code, made the first time, and everything shown until changed. */
    on(profileId: string): Promise<FriendSettings>;
    /** Friends off: the code stops working and the settings go. Friends stay. */
    off(profileId: string): Promise<void>;
    /** A new code; the old one stops working. */
    resetCode(profileId: string): Promise<string>;
    setPrivacy(profileId: string, privacy: FriendPrivacy): Promise<void>;
    list(profileId: string): Promise<FriendEntry[]>;
    request(profileId: string, code: string): Promise<FriendRequestResult>;
    respond(profileId: string, otherId: string, accept: boolean): Promise<void>;
    /** No longer friends, or a request withdrawn. */
    remove(profileId: string, otherId: string): Promise<void>;
    block(profileId: string, otherId: string): Promise<void>;
    unblock(profileId: string, otherId: string): Promise<void>;
    /** Into this profile's watch party: the code only, never what plays or from where. */
    invite(profileId: string, otherId: string, party: string): Promise<void>;
    connect(profileId: string, handlers: FriendsHandlers): FriendsLink;
  };

  auth: {
    /** The restored session's user, if any. */
    current(): Promise<AccountUser | null>;
    /** Session changes from elsewhere (expiry, revoked refresh token). */
    onChange(cb: (user: AccountUser | null) => void): () => void;
    /**
     * Passwordless: email a one-time code. Creates the account if the email
     * is new, so signing in and signing up are the same flow.
     */
    /** `captchaToken`: once the server has asked for a CAPTCHA (`captcha_needed`), the solved one. */
    sendCode(email: string, captchaToken?: string): Promise<void>;
    /** Exchange the emailed code for a session. */
    verifyCode(email: string, code: string): Promise<AccountUser>;
    signOut(): Promise<void>;
    /** Deletes the account and everything synced with it. */
    deleteAccount(): Promise<void>;
  };

  profiles: {
    list(): Promise<Profile[]>;
    create(input: ProfileInput & { position: number }): Promise<Profile>;
    update(id: string, patch: Partial<ProfileInput>): Promise<Profile>;
    remove(id: string): Promise<void>;
  };

  sync: {
    pull(profileId: string, cursor: string | null): Promise<PulledChanges>;
    /**
     * Resolves to whether the links were stored (`false`: the server has no place for them yet),
     * the titles whose progress couldn't be sent (left unpushed, to go again) and, when the
     * account's room for a kind ran out (#110), which kinds the server refused and why: the
     * others still go.
     */
    push(profileId: string, changes: SyncChanges): Promise<PushResult>;
  };

  /** The profile's preferences as one small document (settingsSync.ts merges it per key). */
  settings: {
    get(profileId: string): Promise<RemoteSettings | null>;
    /**
     * Resolves to the `updatedAt` the server stored (it may move a time from the future back), or
     * `null` when it kept a newer document and took nothing (critique H2).
     */
    put(profileId: string, settings: RemoteSettings): Promise<number | null>;
  };

  /** Whole playlists, last write wins per playlist; titles travel packed (playlistCodec). */
  playlists: {
    pull(profileId: string, cursor: string | null): Promise<{ playlists: RemotePlaylist[]; cursor: string | null }>;
    push(profileId: string, playlists: RemotePlaylist[]): Promise<void>;
  };
}
