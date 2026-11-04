/**
 * Small checks for data this app didn't just make: what localStorage kept from an older version,
 * rows pulled from the account, documents another device wrote (critique M9). Each reader keeps
 * what fits and drops the rest, so one bad field never takes the whole thing down with it.
 */
import type { ContentType } from "./types";

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** A finite number. */
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A whole number ≥ 0 (what Rust reads as u32/u64). Numeric strings count: Postgres `bigint` arrives as one. */
export function count(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

export const contentType = (v: unknown): ContentType | undefined => (v === "movie" || v === "series" ? v : undefined);

/** Each element through `read`; the ones it returns `undefined` for are left out. */
export function listOf<T>(v: unknown, read: (item: unknown) => T | undefined): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const item of v) {
    const r = read(item);
    if (r !== undefined) out.push(r);
  }
  return out;
}

/** JSON stored under `key`, or `undefined` when there is none or it doesn't parse. */
export function storedJson(storage: Pick<Storage, "getItem"> | undefined, key: string): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** What JSON calls a value's kind; `null` is its own. */
const kind = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/**
 * The fields of `v` that have the same kind as `template`'s. Keys `template` doesn't have are
 * dropped; where its value is `null` or missing (an optional setting), any string, number,
 * boolean or `null` is kept.
 */
export function likeTemplate<T extends object>(template: T, v: unknown): Partial<T> {
  if (!isRecord(v)) return {};
  const out: Record<string, unknown> = {};
  const t = template as Record<string, unknown>;
  for (const [k, val] of Object.entries(v)) {
    if (!(k in t) || val === undefined) continue;
    const want = kind(t[k]);
    const loose = want === "null" || want === "undefined";
    if (loose ? ["null", "string", "number", "boolean"].includes(kind(val)) : kind(val) === want) out[k] = val;
  }
  return out as Partial<T>;
}
