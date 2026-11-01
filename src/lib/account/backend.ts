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

export interface AccountBackend {
  readonly name: string;

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
}
