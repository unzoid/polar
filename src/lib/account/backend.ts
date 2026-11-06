/**
 * The contract every account provider implements. The app only ever talks to
 * this interface (via `./index.ts`); swapping Supabase for a self-hosted
 * server, PocketBase, etc. means writing one new file like `./supabase.ts`.
 */
import type { AnimeLink } from "../library/identity";
import type { Progress, SyncLibraryItem } from "../types";
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
   * `joined` again after a reconnect; `error` when the room can't be reached.
   * `setup`: the server refused the room itself (not configured for parties),
   * so retrying won't help.
   */
  onStatus(status: "joined" | "error", detail?: { setup: boolean; message: string }): void;
}

export interface AccountBackend {
  readonly name: string;

  /** Realtime rooms for watching together. Signed-in users only. */
  party: {
    connect(code: string, me: PartyPresence, handlers: PartyHandlers): PartyLink;
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
