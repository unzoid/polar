/**
 * Supabase implementation of `AccountBackend`. The only file that imports
 * supabase-js; schema lives in supabase/migrations.
 */
import { createClient, type AuthError, type PostgrestError, type User } from "@supabase/supabase-js";
import type { ContentType, Progress, Stream, SyncLibraryItem } from "../types";
import { AccountError, type AccountBackend, type AccountUser, type Profile } from "./backend";
import { normalizeAvatar } from "./avatars";

const PAGE = 1000;
/** Re-read a little before the cursor: rows committed out of order still arrive. */
const PULL_OVERLAP_MS = 10_000;

export function createSupabaseBackend(url: string, key: string): AccountBackend {
  const db = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "rustio.auth",
    },
  });

  const toUser = (u: User): AccountUser => ({ id: u.id, email: u.email ?? "" });

  return {
    name: "supabase",

    auth: {
      async current() {
        const { data } = await db.auth.getSession();
        return data.session ? toUser(data.session.user) : null;
      },
      onChange(cb) {
        const { data } = db.auth.onAuthStateChange((_event, session) => cb(session ? toUser(session.user) : null));
        return () => data.subscription.unsubscribe();
      },
      // New emails get the "Confirm signup" template, known ones the "Magic
      // Link" template; both must contain {{ .Token }} to send a code.
      async sendCode(email) {
        const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        if (error) throw authError(error);
      },
      async verifyCode(email, code) {
        const { data, error } = await db.auth.verifyOtp({ email, token: code, type: "email" });
        if (error) throw authError(error);
        if (!data.user) throw new AccountError("invalid_code", "That code is wrong or has expired.");
        return toUser(data.user);
      },
      async signOut() {
        const { error } = await db.auth.signOut({ scope: "local" });
        if (error) throw authError(error);
      },
      async deleteAccount() {
        const { error } = await db.rpc("delete_own_account");
        if (error) throw dbError(error);
        await db.auth.signOut({ scope: "local" });
      },
    },

    profiles: {
      async list() {
        const { data, error } = await db
          .from("profiles")
          .select("id, name, avatar, position")
          .order("position")
          .order("created_at");
        if (error) throw dbError(error);
        return data.map(toProfile);
      },
      async create(input) {
        const { data, error } = await db.from("profiles").insert(input).select("id, name, avatar, position").single();
        if (error) throw dbError(error);
        return toProfile(data);
      },
      async update(id, patch) {
        const { data, error } = await db
          .from("profiles")
          .update(patch)
          .eq("id", id)
          .select("id, name, avatar, position")
          .single();
        if (error) throw dbError(error);
        return toProfile(data);
      },
      async remove(id) {
        const { error } = await db.from("profiles").delete().eq("id", id);
        if (error) throw dbError(error);
      },
    },

    sync: {
      async pull(profileId, cursor) {
        const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;
        const [lib, prog] = await Promise.all([
          pullAll<LibraryRow>("library_items", profileId, since),
          pullAll<ProgressRow>("watch_progress", profileId, since),
        ]);
        const newest = [...lib, ...prog].reduce<string | null>(
          (max, r) => (!max || r.synced_at > max ? r.synced_at : max),
          cursor,
        );
        return { library: lib.map(fromLibraryRow), progress: prog.map(fromProgressRow), cursor: newest };
      },
      async push(profileId, { library, progress }) {
        for (const rows of chunks(library.map((i) => toLibraryRow(profileId, i)), 500)) {
          const { error } = await db.from("library_items").upsert(rows, { onConflict: "profile_id,meta_id" });
          if (error) throw dbError(error);
        }
        for (const rows of chunks(progress.map((p) => toProgressRow(profileId, p)), 500)) {
          const { error } = await db.from("watch_progress").upsert(rows, { onConflict: "profile_id,video_id" });
          if (error) throw dbError(error);
        }
      },
    },
  };

  async function pullAll<T>(table: string, profileId: string, since: string | null): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = db.from(table).select("*").eq("profile_id", profileId);
      if (since) q = q.gt("synced_at", since);
      const { data, error } = await q.order("synced_at").range(from, from + PAGE - 1);
      if (error) throw dbError(error);
      out.push(...(data as T[]));
      if (data.length < PAGE) return out;
    }
  }
}

// --- Row mapping -------------------------------------------------------------

interface LibraryRow {
  profile_id: string;
  meta_id: string;
  type: string;
  name: string;
  poster: string | null;
  added_at: number;
  deleted: boolean;
  updated_at: number;
  synced_at: string;
}

interface ProgressRow {
  profile_id: string;
  video_id: string;
  meta_id: string;
  type: string;
  name: string;
  background: string | null;
  poster: string | null;
  season: number | null;
  episode: number | null;
  episode_title: string | null;
  stream: Stream | null;
  position: number;
  duration: number;
  updated_at: number;
  synced_at: string;
}

const toProfile = (r: { id: string; name: string; avatar: string; position: number }): Profile => ({
  id: r.id,
  name: r.name,
  avatar: normalizeAvatar(r.avatar),
  position: r.position,
});

const toLibraryRow = (profileId: string, i: SyncLibraryItem) => ({
  profile_id: profileId,
  meta_id: i.id,
  type: i.type,
  name: i.name,
  poster: i.poster ?? null,
  added_at: i.addedAt,
  deleted: i.deleted,
  updated_at: i.updatedAt,
});

const fromLibraryRow = (r: LibraryRow): SyncLibraryItem => ({
  id: r.meta_id,
  type: r.type as ContentType,
  name: r.name,
  poster: r.poster,
  addedAt: Number(r.added_at),
  deleted: r.deleted,
  updatedAt: Number(r.updated_at),
});

const toProgressRow = (profileId: string, p: Progress) => ({
  profile_id: profileId,
  video_id: p.videoId,
  meta_id: p.metaId,
  type: p.type,
  name: p.name,
  background: p.background ?? null,
  poster: p.poster ?? null,
  season: p.season ?? null,
  episode: p.episode ?? null,
  episode_title: p.episodeTitle ?? null,
  stream: p.stream ?? null,
  position: p.position,
  duration: p.duration,
  updated_at: p.updatedAt,
});

const fromProgressRow = (r: ProgressRow): Progress => ({
  videoId: r.video_id,
  metaId: r.meta_id,
  type: r.type as ContentType,
  name: r.name,
  background: r.background ?? undefined,
  poster: r.poster ?? undefined,
  season: r.season ?? undefined,
  episode: r.episode ?? undefined,
  episodeTitle: r.episode_title ?? undefined,
  stream: r.stream ?? undefined,
  position: r.position,
  duration: r.duration,
  updatedAt: Number(r.updated_at),
});

function* chunks<T>(items: T[], size: number) {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

// --- Errors ------------------------------------------------------------------

function authError(e: AuthError): AccountError {
  switch (e.code) {
    case "email_address_invalid":
    case "validation_failed":
      return new AccountError("invalid_email", "Enter a valid email address.");
    case "otp_expired":
    case "invalid_credentials":
      return new AccountError("invalid_code", "That code is wrong or has expired.");
    case "otp_disabled":
    case "signup_disabled":
      return new AccountError("unknown", "Email sign-in is turned off for this server.");
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return new AccountError("rate_limited", "Too many attempts. Try again in a few minutes.");
  }
  if (e.name === "AuthRetryableFetchError" || e.status === 0) {
    return new AccountError("network", "Can't reach the server. Check your connection.");
  }
  return new AccountError("unknown", e.message || "Something went wrong.");
}

function dbError(e: PostgrestError): AccountError {
  if (e.message?.includes("profile_limit")) {
    return new AccountError("profile_limit", "An account can have up to 5 profiles.");
  }
  if (e.message?.includes("Failed to fetch") || e.message?.includes("NetworkError")) {
    return new AccountError("network", "Can't reach the server. Check your connection.");
  }
  return new AccountError("unknown", e.message || "Something went wrong.");
}
