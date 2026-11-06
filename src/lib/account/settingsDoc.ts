/**
 * The synced settings document (`profile_settings.data`), apart from the app: what goes in, how it
 * travels, how it reads back. settingsSync.ts does the rest. Kept free of `window` so it can be
 * tested.
 *
 * Only what a profile changed from the defaults travels (I-009). API keys and add-on links travel
 * for every account (#89): as they are in a `secrets` field, readable by the server and protected by
 * row-level security, or, once a passphrase is set, sealed with it (secrets.ts) as one `sealed`
 * field the server can't read.
 */
import { isRecord, strings } from "../parse";
import { open, seal, type Secrets } from "./secrets";

/** Settings keys that describe this machine, not the person. */
export const DEVICE_ONLY = new Set<string>(["metadataSource"]);
/** Settings keys that are someone's own accounts elsewhere: they travel in `secrets`, apart from the settings. */
export const SECRET_KEYS = ["tmdbKey", "omdbKey", "mdblistKey", "seekrKey"] as const;
const SECRET = new Set<string>(SECRET_KEYS);

/** Whether a settings key travels in the document at all. */
export const synced = (key: string) => !DEVICE_ONLY.has(key) && !SECRET.has(key);

export interface Doc {
  settings: Record<string, unknown>;
  keybinds: Record<string, string[]>;
  prefs: Record<string, unknown>;
  /** Keys and add-on links in plain text; they travel as they are or sealed. */
  secrets?: Secrets;
  /** A `sealed` field this device can't open (no or another passphrase): sent back as it came, over `secrets`. */
  unopened?: string;
}

/** The values that differ from `defaults`, among the keys `keep` lets through. */
export function changedFrom(values: Record<string, unknown>, defaults: Record<string, unknown>, keep: (key: string) => boolean = () => true) {
  return Object.fromEntries(Object.entries(values).filter(([k, v]) => keep(k) && stable(v) !== stable(defaults[k])));
}

/**
 * What a document means for this device: every synced key at its default unless the document
 * changed it. Keys the document doesn't know of and keys outside `defaults` are left out.
 */
export function withDefaults(changed: Record<string, unknown>, defaults: Record<string, unknown>, keep: (key: string) => boolean = () => true) {
  return Object.fromEntries(
    Object.entries(defaults)
      .map(([k, v]) => [k, k in changed ? changed[k] : v])
      .filter(([k]) => keep(k as string)),
  );
}

/** The document as stored on the server: keys and add-on links sealed with `passphrase`, or as they are without one. */
export async function toWire(doc: Doc, passphrase: string | null): Promise<Record<string, unknown>> {
  const wire: Record<string, unknown> = { settings: doc.settings, keybinds: doc.keybinds, prefs: doc.prefs };
  // A seal this device can't open goes back as it came: another passphrase's keys aren't overwritten.
  if (doc.unopened) wire.sealed = doc.unopened;
  else if (doc.secrets && passphrase) wire.sealed = await seal(passphrase, doc.secrets);
  else if (doc.secrets) wire.secrets = doc.secrets;
  return wire;
}

/** This device's passphrase for an account's keys, kept on the device only (settingsSync.ts). */
export interface Lock {
  passphrase?: string;
  /** The one before a change, still opening what the account holds until the next write. */
  previous?: string;
  /** Set here and not yet written: "set" seals the keys, "remove" sends them back as they are. */
  pending?: "set" | "remove";
}

/**
 * What this round sends: keys sealed with `seal`, or as they are when it's null. A passphrase stays
 * in force while the account's keys are sealed (older versions send a seal back as it came); with
 * nothing sealed there and no change pending here, another device removed it (or it is from before
 * #89, when it did nothing with the option off), so this one `forget`s it too.
 */
export function sealing(lock: Lock, remote: Record<string, unknown> | null): { seal: string | null; forget: boolean } {
  if (!lock.passphrase || lock.pending === "remove") return { seal: null, forget: false };
  if (lock.pending === "set" || typeof remote?.sealed === "string") return { seal: lock.passphrase, forget: false };
  return { seal: null, forget: true };
}

/**
 * A stored document as this device reads it. `read` checks each part as far as it fits (critique
 * M9); a `secrets` field is read the same way, a `sealed` one opens with the first of `passphrases`
 * that fits or is kept unopened. Documents from before I-009 may still carry `addons` and keys in
 * `settings`: neither is taken.
 */
export async function fromWire(
  v: Record<string, unknown>,
  passphrases: string | null | string[],
  read: (v: Record<string, unknown>) => Omit<Doc, "secrets" | "unopened">,
): Promise<Doc> {
  const doc: Doc = read(v);
  doc.settings = Object.fromEntries(Object.entries(doc.settings).filter(([k]) => synced(k)));
  if (typeof v.sealed === "string") {
    for (const p of [passphrases ?? []].flat()) {
      doc.secrets = (await open(p, v.sealed)) ?? undefined;
      if (doc.secrets) break;
    }
    if (!doc.secrets) doc.unopened = v.sealed;
  } else if (isRecord(v.secrets)) {
    doc.secrets = readSecrets(v.secrets);
  }
  return doc;
}

/** Keys and add-on links as far as they fit: text values only, links sorted. */
export function readSecrets(v: Record<string, unknown>): Secrets {
  const keys = isRecord(v.keys) ? Object.entries(v.keys).filter((e): e is [string, string] => typeof e[1] === "string") : [];
  return { keys: Object.fromEntries(keys), addons: [...new Set(strings(v.addons))].sort() };
}

/** Whether two documents say the same; an unopened `sealed` field isn't this device's to compare. */
export const sameDoc = (a: Doc, b: Doc) => stable({ ...a, unopened: undefined }) === stable({ ...b, unopened: undefined });

/** JSON with sorted keys, so equal values compare equal. */
export function stable(v: unknown): string {
  return (
    JSON.stringify(v, (_k, val) => (isRecord(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : val)) ??
    "undefined"
  );
}

type Section = "settings" | "keybinds" | "prefs";
const SECTIONS: Section[] = ["settings", "keybinds", "prefs"];

/**
 * Per-key merge of two edits of one document (critique H3): each key this device changed since
 * `base` (the copy last agreed with the server) keeps this device's value, every other key takes
 * the server's. A key set back to its default is a change too (it leaves the document). Add-on
 * links merge as a set: added or removed here, else as on the server. Keys sealed under a
 * passphrase this device doesn't have stay sealed as they are.
 */
export function mergeDocs(base: Doc, local: Doc, remote: Doc): Doc {
  const doc = {} as Doc;
  for (const s of SECTIONS) doc[s] = mergeRecords(base[s], local[s], remote[s]) as never;
  if (remote.unopened) {
    // Sealed under another passphrase: it stays as it is until this device can open it.
    doc.unopened = remote.unopened;
    if (local.secrets) doc.secrets = local.secrets;
  } else if (local.secrets && remote.secrets) {
    const was = base.secrets ?? { keys: {}, addons: [] };
    const keys = mergeRecords(was.keys, local.secrets.keys, remote.secrets.keys) as Record<string, string>;
    const added = local.secrets.addons.filter((a) => !was.addons.includes(a));
    const removed = new Set(was.addons.filter((a) => !local.secrets!.addons.includes(a)));
    const addons = [...new Set([...remote.secrets.addons, ...added])].filter((a) => !removed.has(a)).sort();
    doc.secrets = { keys, addons };
  } else if (local.secrets ?? remote.secrets) {
    doc.secrets = local.secrets ?? remote.secrets;
  }
  return doc;
}

/**
 * A profile's first round on this device: the server's document wins, except that no add-on this
 * device has is taken away (critique H3), nor a key the server doesn't have (#89).
 */
export const firstDoc = (local: Doc, remote: Doc): Doc => openedDoc(local, local, remote);

/**
 * Keys sealed with a passphrase this device just got: the account's keys and add-ons win, as on a
 * first round, and the rest merges against `base` as usual.
 */
export function openedDoc(base: Doc, local: Doc, remote: Doc): Doc {
  const doc = mergeDocs({ ...base, secrets: local.secrets }, local, remote);
  if (doc.secrets && local.secrets) {
    doc.secrets = {
      keys: { ...local.secrets.keys, ...doc.secrets.keys },
      addons: [...new Set([...doc.secrets.addons, ...local.secrets.addons])].sort(),
    };
  }
  return doc;
}

/**
 * `doc` with the keys of `saved` this version doesn't know (`knows` says no), so an older version
 * passes a newer one's settings on instead of dropping them.
 */
export function withUnknown(doc: Doc, saved: Doc | undefined, knows: Record<Section, (key: string) => boolean>): Doc {
  if (!saved) return doc;
  const out = { ...doc };
  for (const s of SECTIONS) {
    const unknown = Object.entries(saved[s]).filter(([k]) => !knows[s](k));
    if (unknown.length) out[s] = { ...Object.fromEntries(unknown), ...doc[s] } as never;
  }
  return out;
}

/** Three-way merge of flat records; a missing key means "at its default". */
function mergeRecords(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])) {
    const mine = stable(local[k]) !== stable(base[k]);
    const v = mine ? local[k] : remote[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
