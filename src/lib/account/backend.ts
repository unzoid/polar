/**
 * The contract every account provider implements. The app only ever talks to
 * this interface (via `./index.ts`); swapping Supabase for a self-hosted
 * server, PocketBase, etc. means writing one new file like `./supabase.ts`.
 */
import type { Progress, SyncLibraryItem } from "../types";
import type { AvatarId } from "./avatars";

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

export type AccountErrorCode =
  | "invalid_email"
  | "invalid_code"
  | "rate_limited"
  | "profile_limit"
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

export interface PulledChanges {
  library: SyncLibraryItem[];
  progress: Progress[];
  /** Opaque cursor; hand it back to the next `pull`. */
  cursor: string | null;
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
}

/** A live watch-party room: small messages to everyone in it, and who's there. */
export interface PartyLink {
  /** To everyone in the room, this member included (the echo times the round trip). */
  send(message: Record<string, unknown>): void;
  /** Update how this member appears to the others. */
  track(presence: PartyPresence): void;
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
    sendCode(email: string): Promise<void>;
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
    push(profileId: string, changes: { library: SyncLibraryItem[]; progress: Progress[] }): Promise<void>;
  };

  /** The profile's preferences as one small document, last write wins. */
  settings: {
    get(profileId: string): Promise<RemoteSettings | null>;
    put(profileId: string, settings: RemoteSettings): Promise<void>;
  };

  /** Whole playlists, last write wins per playlist; titles travel packed (playlistCodec). */
  playlists: {
    pull(profileId: string, cursor: string | null): Promise<{ playlists: RemotePlaylist[]; cursor: string | null }>;
    push(profileId: string, playlists: RemotePlaylist[]): Promise<void>;
  };
}
