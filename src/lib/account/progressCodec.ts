/**
 * A title's watch progress as bytes: every video of one title packed into the
 * `progress.entries` column (docs/supabase-storage.md §4.1). The SQL trigger
 * that merges pushes (supabase/migrations/*_compact_storage.sql) reads the
 * same format.
 *
 *   [version = 1] then per video, sorted by its key bytes (flags & 3, payload):
 *   [flags] [key payload] [season]? [episode]? [position] [duration] [age]
 *   flags bits 0-1, how the video id is written:
 *     0  the title's own id (a movie), no payload
 *     1  `${meta}:${season}:${episode}`, payload season, episode
 *     2  `${meta}:${episode}`, payload episode
 *     3  any other id, payload length + UTF-8
 *   flags bit 2: has a season; bit 3: has an episode. Numbers the form
 *   doesn't carry follow as varints.
 *   position, duration: whole seconds. age: row time − entry time, ms.
 *
 * Every number is an unsigned LEB128 varint, as in playlistCodec.ts. A typical
 * episode is 10-11 bytes.
 */

export interface ProgressEntry {
  videoId: string;
  season?: number;
  episode?: number;
  /** Seconds; rounded to whole ones when encoded. */
  position: number;
  duration: number;
  /** ms */
  updatedAt: number;
}

/** What `encodeEntries` takes: `null` numbers count as absent, as the native store writes a film's (#94). */
export type EntryToPack = Omit<ProgressEntry, "season" | "episode"> & { season?: number | null; episode?: number | null };

const VERSION = 1;
const OWN = 0;
const SEASON_EPISODE = 1;
const EPISODE = 2;
const OTHER = 3;
const HAS_SEASON = 4;
const HAS_EPISODE = 8;
/** Decimal without leading zeros, so the id is rebuilt exactly. */
const NUMBER = "(0|[1-9]\\d{0,14})";
const SE = new RegExp(`^${NUMBER}:${NUMBER}$`);
const E = new RegExp(`^${NUMBER}$`);

function pushVarint(out: number[], n: number) {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`not a varint: ${n}`);
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
}

const whole = (seconds: number) => (Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0);

/** The key (form + payload) and the numbers the key doesn't carry. */
function key(metaId: string, e: EntryToPack): { key: number[]; season?: number; episode?: number } {
  const out: number[] = [];
  const [season, episode] = [e.season ?? undefined, e.episode ?? undefined];
  const rest = e.videoId.startsWith(`${metaId}:`) ? e.videoId.slice(metaId.length + 1) : null;
  const se = rest === null ? null : SE.exec(rest);
  const ep = rest === null ? null : E.exec(rest);
  if (e.videoId === metaId) {
    out.push(OWN);
    return { key: out, season, episode };
  }
  if (se && season !== undefined && episode !== undefined && Number(se[1]) === season && Number(se[2]) === episode) {
    out.push(SEASON_EPISODE);
    pushVarint(out, season);
    pushVarint(out, episode);
    return { key: out };
  }
  if (ep && episode !== undefined && Number(ep[1]) === episode) {
    out.push(EPISODE);
    pushVarint(out, episode);
    return { key: out, season };
  }
  const bytes = new TextEncoder().encode(e.videoId);
  out.push(OTHER);
  pushVarint(out, bytes.length);
  out.push(...bytes);
  return { key: out, season, episode };
}

function compareBytes(a: number[], b: number[]) {
  for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** The newest entry's time: what the row's `updated_at` must be for `encodeEntries`'s ages. */
export const newestAt = (entries: { updatedAt: number }[]) => entries.reduce((max, e) => Math.max(max, e.updatedAt), 0);

/**
 * Packs one title's entries. A video listed twice keeps its newest entry.
 * Ages are measured from `newestAt(entries)`, which the row must carry as
 * its `updated_at`.
 */
export function encodeEntries(metaId: string, entries: EntryToPack[]): Uint8Array {
  const newest = new Map<string, EntryToPack>();
  for (const e of entries) {
    const seen = newest.get(e.videoId);
    if (!seen || e.updatedAt > seen.updatedAt) newest.set(e.videoId, e);
  }
  const top = newestAt([...newest.values()]);
  const coded = [...newest.values()].map((e) => {
    const k = key(metaId, e);
    const flags = (e.season != null ? HAS_SEASON : 0) | (e.episode != null ? HAS_EPISODE : 0);
    const tail: number[] = [];
    if (k.season !== undefined) pushVarint(tail, k.season);
    if (k.episode !== undefined) pushVarint(tail, k.episode);
    pushVarint(tail, whole(e.position));
    pushVarint(tail, whole(e.duration));
    pushVarint(tail, top - e.updatedAt);
    return { key: k.key, flags, tail };
  });
  coded.sort((a, b) => compareBytes(a.key, b.key));
  const out: number[] = [VERSION];
  for (const c of coded) out.push(c.key[0] | c.flags, ...c.key.slice(1), ...c.tail);
  return Uint8Array.from(out);
}

/**
 * The entries of a row whose `updated_at` is `rowAt`, or `null` when the bytes
 * are of a version this app doesn't know or are broken: then the row must be
 * left as it is, never re-encoded (critique H5).
 */
export function decodeEntries(metaId: string, bytes: Uint8Array, rowAt: number): ProgressEntry[] | null {
  if (bytes[0] !== VERSION) return null;
  let i = 1;
  const varint = () => {
    let n = 0;
    let scale = 1;
    while (i < bytes.length) {
      const b = bytes[i++];
      n += (b & 0x7f) * scale;
      if (b < 0x80) {
        if (!Number.isSafeInteger(n)) throw new RangeError("varint too large");
        return n;
      }
      scale *= 0x80;
    }
    throw new RangeError("truncated progress entries");
  };
  const entries: ProgressEntry[] = [];
  try {
    while (i < bytes.length) {
      const flags = bytes[i++];
      if (flags > 15) return null;
      let videoId = metaId;
      let season: number | undefined;
      let episode: number | undefined;
      switch (flags & 3) {
        case SEASON_EPISODE:
          season = varint();
          episode = varint();
          videoId = `${metaId}:${season}:${episode}`;
          break;
        case EPISODE:
          episode = varint();
          videoId = `${metaId}:${episode}`;
          break;
        case OTHER: {
          const len = varint();
          if (i + len > bytes.length) return null;
          videoId = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(i, i + len));
          i += len;
        }
      }
      if (flags & HAS_SEASON && season === undefined) season = varint();
      if (flags & HAS_EPISODE && episode === undefined) episode = varint();
      const [position, duration, age] = [varint(), varint(), varint()];
      if (age > rowAt) return null;
      entries.push({
        videoId,
        ...(season !== undefined && { season }),
        ...(episode !== undefined && { episode }),
        position,
        duration,
        updatedAt: rowAt - age,
      });
    }
  } catch {
    return null;
  }
  return entries;
}
