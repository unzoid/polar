/**
 * Supabase implementation of `AccountBackend`. The only file that imports
 * supabase-js; schema lives in supabase/migrations.
 */
import { createClient, type AuthError, type PostgrestError, type User } from "@supabase/supabase-js";
import type { AnimeLink } from "../library/identity";
import type { Progress, SyncLibraryItem } from "../types";
import { count, isRecord, listOf, str } from "../parse";
import { AccountError, type AccountBackend, type AccountUser, type Profile, type RemotePlaylist } from "./backend";
import { parsePresence } from "../party/messages";
import { normalizeAvatar } from "./avatars";
import { fromHex, toHex } from "../library/playlistCodec";
import { decodeEntries, encodeEntries, newestAt, type ProgressEntry } from "./progressCodec";
import { keychainStorage } from "../platform/keychain";

const PAGE = 1000;
/** Re-read a little before the cursor: rows committed out of order still arrive. */
const PULL_OVERLAP_MS = 10_000;
/** Only the user's own data travels: ids, times, where they stopped; never names or pictures (docs/supabase-storage.md §3). */
const LIBRARY_COLUMNS = "meta_id, kind, added_at, updated_at, synced_at";
const PROGRESS_COLUMNS = "meta_id, kind, entries, updated_at, synced_at";
const LINK_COLUMNS = "anilist, canonical, mal, kitsu, updated_at, synced_at";

export interface SupabaseOptions {
  /** Push every changed episode, not only each title's newest (the server must run supabase/optional/per_episode_progress.sql). */
  everyEpisode?: () => boolean;
}

export function createSupabaseBackend(url: string, key: string, options: SupabaseOptions = {}): AccountBackend {
  const db = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "polar.auth",
      // The session goes to the system keychain where there is one.
      storage: keychainStorage(),
    },
  });

  const toUser = (u: User): AccountUser => ({ id: u.id, email: u.email ?? "" });

  return {
    name: "supabase",

    // Broadcast + Presence on a private channel: only signed-in users get in
    // (realtime.messages policies, see the watch_parties migration), and the
    // code is the invitation. Nothing is stored.
    party: {
      connect(code, me, { onMessage, onPresence, onStatus }) {
        let current = me;
        const ch = db.channel(`party:${code}`, {
          config: { private: true, broadcast: { self: true }, presence: { key: me.id } },
        });
        ch.on("broadcast", { event: "m" }, ({ payload }) => onMessage(payload as Record<string, unknown>));
        ch.on("presence", { event: "sync" }, () => {
          // Checked here: each entry must carry the key it was tracked under (critique M11).
          onPresence(parsePresence(ch.presenceState()));
        });
        const fail = (err?: Error) => {
          const message = err?.message ?? "";
          if (message) console.warn("[party] realtime:", message);
          // Realtime refuses a private topic no policy allows: the server is missing the watch_parties migration.
          onStatus("error", { setup: /unauthori[sz]ed|permission|policy|not allowed/i.test(message), message });
        };
        db.realtime
          .setAuth()
          .then(() =>
            ch.subscribe((status, err) => {
              if (status === "SUBSCRIBED") {
                void ch.track(current);
                onStatus("joined");
              } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") fail(err);
            }),
          )
          .catch(fail);
        return {
          send: (message) => void ch.send({ type: "broadcast", event: "m", payload: message }),
          track: (presence) => {
            current = presence;
            void ch.track(presence);
          },
          close: () => void db.removeChannel(ch),
        };
      },
    },

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
        const [lib, prog, links] = await Promise.all([
          pullAll("library", "meta_id", profileId, since, LIBRARY_COLUMNS),
          pullAll("progress", "meta_id", profileId, since, PROGRESS_COLUMNS),
          unlessMissing(pullAll("anime_links", "anilist", profileId, since, LINK_COLUMNS)),
        ]);
        // Rows that don't fit are left out (critique M9), but still move the cursor past them.
        return {
          library: listOf(lib, fromLibraryRow),
          progress: listOf(prog, fromProgressRow).flat(),
          links: links && listOf(links, fromLinkRow),
          cursor: newestSynced([...lib, ...prog, ...(links ?? [])], cursor),
        };
      },
      async push(profileId, { library, progress, links }) {
        for (const rows of chunks(library.map((i) => toLibraryRow(profileId, i)), 500)) {
          const { error } = await db.from("library").upsert(rows, { onConflict: "profile_id,meta_id" });
          if (error) throw dbError(error);
        }
        for (const rows of chunks(toProgressRows(profileId, progress, options.everyEpisode?.() ?? false), 500)) {
          const { error } = await db.from("progress").upsert(rows, { onConflict: "profile_id,meta_id" });
          if (error) throw dbError(error);
        }
        for (const rows of chunks(links.map((l) => toLinkRow(profileId, l)), 500)) {
          const { error } = await db.from("anime_links").upsert(rows, { onConflict: "profile_id,anilist" });
          if (error && isMissingTable(error)) return { links: false };
          if (error) throw dbError(error);
        }
        return { links: true };
      },
    },

    settings: {
      async get(profileId) {
        const { data, error } = await db
          .from("profile_settings")
          .select("data, updated_at")
          .eq("profile_id", profileId)
          .maybeSingle();
        if (error) throw dbError(error);
        return data && isRecord(data.data) ? { data: data.data, updatedAt: count(data.updated_at) ?? 0 } : null;
      },
      async put(profileId, { data, updatedAt }) {
        // The sync_lww trigger skips a write older than what's stored: then no row comes back.
        const { data: rows, error } = await db
          .from("profile_settings")
          .upsert({ profile_id: profileId, data, updated_at: updatedAt }, { onConflict: "profile_id" })
          .select("updated_at");
        if (error) throw dbError(error);
        return rows.length ? (count(rows[0].updated_at) ?? updatedAt) : null;
      },
    },

    playlists: {
      async pull(profileId, cursor) {
        const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;
        const rows = await pullAll("playlists", "id", profileId, since);
        return { playlists: listOf(rows, fromPlaylistRow), cursor: newestSynced(rows, cursor) };
      },
      async push(profileId, playlists) {
        const rows = playlists.map((p) => ({
          id: p.id,
          profile_id: profileId,
          name: p.name,
          items: toHex(p.items),
          deleted: p.deleted,
          updated_at: p.updatedAt,
        }));
        for (const part of chunks(rows, 200)) {
          const { error } = await db.from("playlists").upsert(part, { onConflict: "id" });
          if (error) throw dbError(error);
        }
      },
    },
  };

  /** `null` when the table isn't on the server yet (a schema older than this app). */
  async function unlessMissing<T>(rows: Promise<T[]>): Promise<T[] | null> {
    try {
      return await rows;
    } catch (e) {
      if (e instanceof AccountError && e.code === "not_set_up") return null;
      throw e;
    }
  }

  /** Pages in a fixed order: by server time, then by key, so rows stamped alike can't swap between pages (critique M8). */
  async function pullAll(table: string, key: string, profileId: string, since: string | null, columns = "*"): Promise<unknown[]> {
    const out: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = db.from(table).select(columns).eq("profile_id", profileId);
      if (since) q = q.gt("synced_at", since);
      const { data, error } = await q
        .order("synced_at")
        .order(key)
        .range(from, from + PAGE - 1);
      if (error) throw dbError(error);
      out.push(...(data as unknown[]));
      if (data.length < PAGE) return out;
    }
  }
}

// --- Row mapping -------------------------------------------------------------

/** The newest `synced_at` among pulled rows, or `cursor` when none is newer. */
function newestSynced(rows: unknown[], cursor: string | null): string | null {
  let max = cursor;
  for (const r of rows) {
    const at = isRecord(r) ? str(r.synced_at) : undefined;
    if (at && (!max || at > max)) max = at;
  }
  return max;
}

const toProfile = (r: { id: string; name: string; avatar: string; position: number }): Profile => ({
  id: r.id,
  name: r.name,
  avatar: normalizeAvatar(r.avatar),
  position: r.position,
});

/** `library.kind` and `progress.kind`: 0 movie, 1 series; on library rows + REMOVED for a removal. */
const SERIES = 1;
const REMOVED = 128;

export const toLibraryRow = (profileId: string, i: SyncLibraryItem) => ({
  profile_id: profileId,
  meta_id: i.id,
  kind: (i.type === "series" ? SERIES : 0) + (i.deleted ? REMOVED : 0),
  // Seconds: it only orders the library.
  added_at: Math.floor(i.addedAt / 1000),
  updated_at: i.updatedAt,
});

/**
 * A `library` row (LIBRARY_COLUMNS). It carries no name or poster: `name` comes back empty and
 * the device keeps or looks up its own. `added_at` is in seconds; an item never changed since it
 * was added gets its exact time back from `updated_at`.
 */
export function fromLibraryRow(r: unknown): SyncLibraryItem | undefined {
  if (!isRecord(r)) return;
  const [id, kind, added, updatedAt] = [str(r.meta_id), count(r.kind), count(r.added_at), count(r.updated_at)];
  if (!id || kind === undefined || ![0, 1, REMOVED, REMOVED + 1].includes(kind) || added === undefined || updatedAt === undefined) return;
  const deleted = kind >= REMOVED;
  return {
    id,
    type: deleted ? "" : kind & SERIES ? "series" : "movie",
    name: "",
    poster: null,
    addedAt: Math.floor(updatedAt / 1000) === added ? updatedAt : added * 1000,
    deleted,
    updatedAt,
  };
}

/** Watched past the start (crates/library space.rs `Progress::started`): what Continue Watching counts. */
const STARTED_S = 30;

/**
 * Progress as `progress` rows, one per title. Unless `everyEpisode`, a row holds only the title's
 * newest entry watched past the start (what Continue Watching needs), so a few seconds of another
 * episode never take the place of the one being watched (test report 1, item 4); a title with no
 * such entry sends nothing. Other episodes stay on this device.
 */
export function toProgressRows(profileId: string, progress: Progress[], everyEpisode: boolean) {
  const titles = new Map<string, Progress[]>();
  for (const p of progress) {
    if (everyEpisode || p.position > STARTED_S) titles.set(p.metaId, [...(titles.get(p.metaId) ?? []), p]);
  }
  return [...titles].map(([metaId, list]) => {
    const newest = list.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
    const entries: ProgressEntry[] = (everyEpisode ? list : [newest]).map((p) => ({
      videoId: p.videoId,
      season: p.season,
      episode: p.episode,
      position: p.position,
      duration: p.duration,
      updatedAt: p.updatedAt,
    }));
    return {
      profile_id: profileId,
      meta_id: metaId,
      kind: newest.type === "series" ? SERIES : 0,
      entries: toHex(encodeEntries(metaId, entries)),
      updated_at: newestAt(entries),
    };
  });
}

/**
 * A `progress` row (PROGRESS_COLUMNS) as one Progress per video, without names or pictures. A row
 * this version can't decode is left out (and, never pulled into the store, never pushed back over).
 * Season and episode must fit Rust's u32.
 */
export function fromProgressRow(r: unknown): Progress[] | undefined {
  if (!isRecord(r)) return;
  const [metaId, kind, hex, updatedAt] = [str(r.meta_id), count(r.kind), str(r.entries), count(r.updated_at)];
  if (!metaId || (kind !== 0 && kind !== SERIES) || hex === undefined || !/^(\\x)?([0-9a-f]{2})*$/i.test(hex) || updatedAt === undefined) return;
  const entries = decodeEntries(metaId, fromHex(hex), updatedAt);
  if (!entries) return;
  const type = kind === SERIES ? "series" : "movie";
  return entries
    .filter((e) => (e.season ?? 0) <= U32_MAX && (e.episode ?? 0) <= U32_MAX)
    .map((e) => ({ metaId, type, name: "", ...e }));
}

const U32_MAX = 0xffff_ffff;

export const toLinkRow = (profileId: string, l: AnimeLink) => ({
  profile_id: profileId,
  anilist: l.anilist,
  canonical: l.canonical,
  mal: l.mal ?? null,
  kitsu: l.kitsu ?? null,
  updated_at: l.updatedAt,
});

/** An `anime_links` row (LINK_COLUMNS). */
export function fromLinkRow(r: unknown): AnimeLink | undefined {
  if (!isRecord(r)) return;
  const [canonical, anilist, mal, kitsu, updatedAt] = [str(r.canonical), count(r.anilist), count(r.mal), count(r.kitsu), count(r.updated_at)];
  if (!canonical || anilist === undefined || updatedAt === undefined) return;
  return { canonical, anilist, ...(mal !== undefined && { mal }), ...(kitsu !== undefined && { kitsu }), updatedAt };
}

/** A `playlists` row; `items` is the packed list as Postgres hex (`\x…`). */
export function fromPlaylistRow(r: unknown): RemotePlaylist | undefined {
  if (!isRecord(r)) return;
  const [id, name, items, updatedAt] = [str(r.id), str(r.name), str(r.items), count(r.updated_at)];
  if (!id || name === undefined || items === undefined || !/^(\\x)?([0-9a-f]{2})*$/i.test(items) || updatedAt === undefined) return;
  return { id, name, items: fromHex(items), deleted: r.deleted === true, updatedAt };
}

function* chunks<T>(items: T[], size: number) {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

// --- Errors ------------------------------------------------------------------

/** A table this version expects hasn't been migrated onto the server yet. */
const isMissingTable = (e: PostgrestError) => e.code === "PGRST205" || e.code === "42P01";

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

/** The limit triggers `raise exception 'profile_limit'` / `'playlist_limit'` (SQLSTATE P0001, the name as the message). */
const raised = (e: PostgrestError, name: string) => e.code === "P0001" && e.message === name;

export function dbError(e: PostgrestError): AccountError {
  if (raised(e, "profile_limit")) {
    return new AccountError("profile_limit", "An account can have up to 5 profiles.");
  }
  if (raised(e, "playlist_limit")) {
    return new AccountError("playlist_limit", "A profile can have up to 100 playlists.");
  }
  // profile_settings.data has a size check (critique M7).
  if (e.code === "23514" && /profile_settings/.test(e.message)) {
    return new AccountError("settings_too_large", "This profile's settings are too large to sync.");
  }
  if (isMissingTable(e)) {
    return new AccountError("not_set_up", e.message);
  }
  // The server answers every error with a code; postgrest-js reports a request that never got an answer with none.
  if (!e.code) {
    return new AccountError("network", "Can't reach the server. Check your connection.");
  }
  return new AccountError("unknown", e.message || "Something went wrong.");
}
