/**
 * The synced settings document (`profile_settings.data`), apart from the app: what goes in, how it
 * travels, how it reads back. settingsSync.ts does the rest. Kept free of `window` so it can be
 * tested.
 *
 * Only what a profile changed from the defaults travels (I-009), never API keys or add-on links:
 * those stay on each device, unless the `syncSecrets` option is on, when they travel sealed with a
 * passphrase (secrets.ts) as one `sealed` field.
 */
import { isRecord } from "../parse";
import { open, seal, type Secrets } from "./secrets";

/** Settings keys that describe this machine, not the person. */
export const DEVICE_ONLY = new Set<string>(["metadataSource"]);
/** Settings keys that are someone's own accounts elsewhere: never sent readable. */
export const SECRET_KEYS = ["tmdbKey", "omdbKey", "mdblistKey", "seekrKey"] as const;
const SECRET = new Set<string>(SECRET_KEYS);

/** Whether a settings key travels in the document at all. */
export const synced = (key: string) => !DEVICE_ONLY.has(key) && !SECRET.has(key);

export interface Doc {
  settings: Record<string, unknown>;
  keybinds: Record<string, string[]>;
  prefs: Record<string, unknown>;
  /** Keys and add-on links in plain text: only on this device; they travel sealed. */
  secrets?: Secrets;
  /** A `sealed` field this device can't open (no or another passphrase): sent back as it came. */
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

/** The document as stored on the server. */
export async function toWire(doc: Doc, passphrase: string | null): Promise<Record<string, unknown>> {
  const sealed = doc.secrets && passphrase ? await seal(passphrase, doc.secrets) : doc.unopened;
  return { settings: doc.settings, keybinds: doc.keybinds, prefs: doc.prefs, ...(sealed && { sealed }) };
}

/**
 * A stored document as this device reads it. `read` checks each part as far as it fits (critique
 * M9); a `sealed` field opens with `passphrase` or is kept unopened. Documents from before I-009
 * may still carry `addons` and keys in `settings`: neither is taken.
 */
export async function fromWire(
  v: Record<string, unknown>,
  passphrase: string | null,
  read: (v: Record<string, unknown>) => Omit<Doc, "secrets" | "unopened">,
): Promise<Doc> {
  const doc: Doc = read(v);
  doc.settings = Object.fromEntries(Object.entries(doc.settings).filter(([k]) => synced(k)));
  if (typeof v.sealed === "string") {
    const secrets = passphrase ? await open(passphrase, v.sealed) : null;
    if (secrets) doc.secrets = secrets;
    else doc.unopened = v.sealed;
  }
  return doc;
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
