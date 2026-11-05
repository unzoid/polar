/**
 * Keeps a profile's preferences the same on every device: player and subtitle settings, interface
 * options, keyboard shortcuts. One small JSON document per profile (settingsDoc.ts), last write
 * wins, holding only what the profile changed from the defaults.
 *
 * What stays on the device: API keys and add-on links (I-009; with the `syncSecrets` option on they
 * travel sealed with a passphrase), the metadata source, volume, TV mode and its sounds, controller
 * alerts.
 *
 * Settings are global in the Rust store, so entering a profile first puts
 * back the copy this device last synced for it (`restore`), then `syncSettings`
 * catches up with the server. The device's own settings (guest, signed out)
 * are kept aside while a profile has the store, and put back at sign-out.
 */
import { api } from "../api";
import { queryClient } from "../net/queries";
import { applyBindingOverrides, bindingOverrides, readBindings } from "../settings/keybinds";
import { isRecord, likeTemplate, storedJson, strings } from "../parse";
import { getPrefs, PREF_DEFAULTS, readPrefs, setPrefs, SYNCED_PREFS } from "../settings/prefs";
import type { Settings } from "../types";
import { AccountError, type AccountBackend } from "./backend";
import { keys } from "../net/queryKeys";
import { changedFrom, fromWire, sameDoc, SECRET_KEYS, synced, toWire, withDefaults, type Doc } from "./settingsDoc";
import type { Secrets } from "./secrets";

interface Saved {
  /** The document as last agreed with the server (secrets in plain text: this device's own). */
  doc: Doc;
  /** Its `updatedAt` there. */
  at: number;
  /** Addon URLs from sealed secrets that couldn't be installed here (yet). */
  missing: string[];
}

const storageKey = (space: string) => `polar.settingsSync.${space}`;
const passphraseKey = (space: string) => `polar.secretsPassphrase.${space}`;

/** The passphrase for this profile's sealed keys on this device, while `syncSecrets` is on. */
function passphrase(space: string): string | null {
  return getPrefs().syncSecrets ? localStorage.getItem(passphraseKey(space)) || null : null;
}

/** Settings → Account: the passphrase for sealed keys and add-on links, kept on this device only. */
export function setSecretsPassphrase(space: string, value: string | null) {
  if (value) localStorage.setItem(passphraseKey(space), value);
  else localStorage.removeItem(passphraseKey(space));
}
export const hasSecretsPassphrase = (space: string) => !!localStorage.getItem(passphraseKey(space));

/** Set while the account holds sealed keys this device couldn't open: Settings → Account says so. */
export let secretsLocked = false;

function load(space: string): Saved | null {
  const v = storedJson(localStorage, storageKey(space));
  if (!isRecord(v) || !isRecord(v.doc)) return null;
  const doc = readDoc(v.doc);
  if (isRecord(v.doc.secrets)) doc.secrets = { keys: readKeys(v.doc.secrets.keys), addons: strings(v.doc.secrets.addons) };
  if (typeof v.doc.unopened === "string") doc.unopened = v.doc.unopened;
  return { doc, at: typeof v.at === "number" ? v.at : 0, missing: strings(v.missing) };
}

const readKeys = (v: unknown): Record<string, string> =>
  isRecord(v) ? Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string")) : {};

/**
 * A document from the server or this device's copy, another version's included, as far as it
 * fits (critique M9). Settings are checked against this device's own when applied.
 */
function readDoc(v: Record<string, unknown>): Doc {
  return {
    settings: isRecord(v.settings) ? v.settings : {},
    keybinds: readBindings(v.keybinds) as Record<string, string[]>,
    prefs: readPrefs(v.prefs),
  };
}
const save = (space: string, s: Saved) => localStorage.setItem(storageKey(space), JSON.stringify(s));
export const forgetSettings = (space: string) => {
  localStorage.removeItem(storageKey(space));
  localStorage.removeItem(passphraseKey(space));
};

/** True while a synced doc is being written locally, so it isn't pushed straight back. */
export let applying = false;

let defaults: Promise<Record<string, unknown>> | null = null;
/** The store's defaults, asked once (they only change with the app). */
const settingsDefaults = () => (defaults ??= api.settingsDefaults().then((d) => d as unknown as Record<string, unknown>));

/** This device's settings as a document; `space` decides whether keys and add-on links go in sealed. */
async function current(space: string, saved: Saved | null): Promise<Doc> {
  const [settings, base] = await Promise.all([api.settings(), settingsDefaults()]);
  const prefs = getPrefs();
  const doc: Doc = {
    settings: changedFrom(settings as unknown as Record<string, unknown>, base, synced),
    keybinds: bindingOverrides() as Record<string, string[]>,
    prefs: changedFrom(
      Object.fromEntries(SYNCED_PREFS.map((k) => [k, prefs[k]])),
      PREF_DEFAULTS as unknown as Record<string, unknown>,
    ),
  };
  if (passphrase(space)) {
    doc.secrets = await ownSecrets(settings, saved?.missing ?? []);
  } else if (saved?.doc.unopened) {
    doc.unopened = saved.doc.unopened;
  }
  return doc;
}

/** This device's keys and add-on links (with those that didn't install yet). */
async function ownSecrets(settings: Settings, missing: string[]): Promise<Secrets> {
  const own = settings as unknown as Record<string, unknown>;
  const addons = await api.addons();
  return {
    keys: Object.fromEntries(SECRET_KEYS.flatMap((k) => (typeof own[k] === "string" && own[k] ? [[k, own[k] as string]] : []))),
    addons: [...new Set([...addons.map((a) => a.manifestUrl), ...missing])].sort(),
  };
}

/** Write `doc` over this device's settings. Returns addon URLs that didn't install. */
async function apply(doc: Doc): Promise<string[]> {
  applying = true;
  try {
    queryClient.setQueryData(["settings"], await saveSynced(doc.settings, doc.secrets));
    applyBindingOverrides(doc.keybinds);
    setPrefs(withDefaults(doc.prefs, Object.fromEntries(SYNCED_PREFS.map((k) => [k, PREF_DEFAULTS[k]]))), { quiet: true });
    secretsLocked = !!doc.unopened && getPrefs().syncSecrets;
    return doc.secrets ? await applyAddons(doc.secrets.addons) : [];
  } finally {
    applying = false;
  }
}

/** Installs and removes add-ons until this device has exactly `urls`. Returns those that didn't install. */
async function applyAddons(urls: string[]): Promise<string[]> {
  const wanted = new Set(urls);
  const installed = await api.addons();
  for (const a of installed) if (!wanted.has(a.manifestUrl)) await api.removeAddon(a.manifest.id);
  const have = new Set(installed.map((a) => a.manifestUrl));
  const missing: string[] = [];
  for (const url of wanted) {
    if (have.has(url)) continue;
    await api.installAddon(url).catch(() => missing.push(url));
  }
  queryClient.invalidateQueries({ queryKey: keys.addons });
  queryClient.invalidateQueries({ queryKey: keys.streamsAll });
  return missing;
}

/**
 * Synced settings over this device's: every synced key at its default unless the document changed
 * it, each of the kind it has here; keys and the metadata source stay unless sealed secrets came.
 * When the store still refuses them (a value another version allows), they go in one at a time and
 * the ones it refuses are left out, so a bad value can't stop the rest on every run.
 */
async function saveSynced(changed: Record<string, unknown>, secrets: Secrets | undefined): Promise<Settings> {
  const [local, base] = await Promise.all([api.settings(), settingsDefaults()]);
  const all = withDefaults(changed, base, synced);
  if (secrets) for (const k of SECRET_KEYS) all[k] = secrets.keys[k] ?? null;
  const wanted = Object.entries(likeTemplate(local, all));
  try {
    return await api.saveSettings({ ...local, ...Object.fromEntries(wanted) });
  } catch {
    let saved = local;
    for (const [k, v] of wanted) saved = await api.saveSettings({ ...saved, [k]: v }).catch(() => saved);
    return saved;
  }
}

/** Entering a profile: put back what this device last synced for it. */
export async function restoreSettings(space: string) {
  const saved = load(space);
  if (!saved) return;
  const missing = await apply(saved.doc);
  save(space, { ...saved, missing });
}

/**
 * Whose settings the global store holds: a profile id, or DEVICE (guest, signed out). Unset after
 * an update while signed in, when nobody knows; then there's no device copy to keep or put back.
 */
const OWNER_KEY = "polar.settingsOwner";
const DEVICE = "local";

/** Signed out or a guest: what's in the store now is the device's own. */
export function markDeviceSettings() {
  if (localStorage.getItem(OWNER_KEY) === null) localStorage.setItem(OWNER_KEY, DEVICE);
}

/**
 * Entering a profile: when the store still holds the device's own settings, keep a copy to put
 * back at sign-out (critique M12), then hand the store to the profile. The copy holds the keys and
 * add-ons in plain text, so signing out gives the device back exactly what it had.
 */
export async function keepDeviceSettings(space: string) {
  if (localStorage.getItem(OWNER_KEY) === DEVICE) {
    const missing = load(DEVICE)?.missing ?? [];
    const doc = await current(DEVICE, null);
    doc.secrets = await ownSecrets(await api.settings(), missing);
    save(DEVICE, { doc, at: 0, missing });
  }
  localStorage.setItem(OWNER_KEY, space);
}

/** Signed out: the device's settings back as they were before a profile was entered. */
export async function restoreDeviceSettings() {
  if (localStorage.getItem(OWNER_KEY) !== DEVICE) await restoreSettings(DEVICE);
  localStorage.setItem(OWNER_KEY, DEVICE);
}

/** One round with the server. Safe to call often: it's a single small read. */
export async function syncSettings(space: string, backend: AccountBackend, isActive: () => boolean) {
  let remote;
  try {
    remote = await backend.settings.get(space);
  } catch (e) {
    // Server hasn't been migrated for settings yet: everything else still syncs.
    if (e instanceof AccountError && e.code === "not_set_up") return;
    throw e;
  }
  if (!isActive()) return;
  const saved = load(space);
  const local = await current(space, saved);

  const push = async () => {
    const at = Date.now();
    await backend.settings.put(space, { data: await toWire(local, passphrase(space)), updatedAt: at });
    save(space, { doc: local, at, missing: saved?.missing ?? [] });
  };
  const take = async (r: { data: Record<string, unknown>; updatedAt: number }) => {
    const doc = await fromWire(r.data, passphrase(space), readDoc);
    const missing = await apply(doc);
    save(space, { doc, at: r.updatedAt, missing });
  };

  // First time this profile is used on this device: the account's copy wins;
  // a brand-new profile starts from this device's settings.
  if (!saved) return remote ? take(remote) : push();

  const changedHere = !sameDoc(local, saved.doc);
  // Edited here since the last sync: that's the newest write (sync runs
  // seconds after a change), so it wins over anything older on the server.
  if (changedHere) return push();
  if (!remote) return push();
  if (remote.updatedAt > saved.at) return take(remote);
}
