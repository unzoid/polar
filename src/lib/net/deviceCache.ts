import { isRecord } from "../parse";

/**
 * Answers of public catalogue APIs kept on this device, so a page draws at once on the next
 * visit and the next start, then refreshes in the background (#109). Only in this device's
 * storage: nothing here is synced or sent anywhere.
 *
 * Each entry keeps when it came; a reader passes how old it may be. The whole store stays under
 * {@link BUDGET} characters, the oldest entries going first.
 */
const PREFIX = "polar.cache.";
const INDEX = "polar.cache-index";
/** In characters (localStorage counts UTF-16 units): about a third of what a webview allows an origin. */
export const BUDGET = 1_500_000;

type Index = Record<string, { at: number; size: number }>;

const storage = (): Storage | undefined => (typeof localStorage === "undefined" ? undefined : localStorage);

function readIndex(s: Storage): Index {
  let raw: unknown;
  try {
    raw = JSON.parse(s.getItem(INDEX) ?? "{}");
  } catch {
    raw = undefined;
  }
  const index: Index = {};
  if (!isRecord(raw)) return index;
  for (const [k, v] of Object.entries(raw)) {
    if (isRecord(v) && typeof v.at === "number" && typeof v.size === "number") index[k] = { at: v.at, size: v.size };
  }
  return index;
}

/** What was kept under `key`, if it's younger than `maxAge` ms. */
export function readCached(key: string, maxAge: number, now = Date.now()): { data: unknown; at: number } | undefined {
  const s = storage();
  if (!s) return undefined;
  try {
    const raw: unknown = JSON.parse(s.getItem(PREFIX + key) ?? "null");
    if (!isRecord(raw) || typeof raw.at !== "number" || !("data" in raw)) return undefined;
    if (now - raw.at > maxAge || raw.at > now) return undefined;
    return { data: raw.data, at: raw.at };
  } catch {
    return undefined;
  }
}

/** Keeps `data` under `key`, making room by dropping the oldest entries; gives up quietly when storage is full. */
export function writeCached(key: string, data: unknown, now = Date.now()) {
  const s = storage();
  if (!s) return;
  const value = JSON.stringify({ at: now, data });
  if (value.length > BUDGET / 4) return;
  const index = readIndex(s);
  delete index[key];
  // Entries whose item went missing (cleared storage) don't count.
  for (const k of Object.keys(index)) if (s.getItem(PREFIX + k) === null) delete index[k];
  let total = Object.values(index).reduce((n, e) => n + e.size, 0) + value.length;
  const oldest = Object.entries(index).sort((a, b) => a[1].at - b[1].at);
  const drop = () => {
    const [k, e] = oldest.shift()!;
    s.removeItem(PREFIX + k);
    delete index[k];
    total -= e.size;
  };
  while (total > BUDGET && oldest.length) drop();
  for (;;) {
    try {
      s.setItem(PREFIX + key, value);
      index[key] = { at: now, size: value.length };
      break;
    } catch {
      // The origin's quota is shared with everything else the app keeps.
      if (!oldest.length) break;
      drop();
    }
  }
  try {
    s.setItem(INDEX, JSON.stringify(index));
  } catch {
    // The entries themselves are still readable; the index is rebuilt as they're written again.
  }
}

/** Drops everything kept here. */
export function clearCached() {
  const s = storage();
  if (!s) return;
  for (const k of Object.keys(readIndex(s))) s.removeItem(PREFIX + k);
  s.removeItem(INDEX);
}

/** Roughly how many bytes are kept here (two a character, as webviews store them). */
export function cachedBytes(): number {
  const s = storage();
  return s ? Object.values(readIndex(s)).reduce((n, e) => n + e.size * 2, 0) : 0;
}
