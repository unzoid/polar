/**
 * Keeps a profile's preferences the same on every device: player and
 * subtitle settings, interface options, keyboard shortcuts and installed
 * addons (as manifest URLs; manifests are fetched again on arrival). One
 * small JSON document per profile, last write wins.
 *
 * What stays on the device: the metadata source, volume, TV mode and its
 * sounds, controller alerts.
 *
 * Settings are global in the Rust store, so entering a profile first puts
 * back the copy this device last synced for it (`restore`), then `syncSettings`
 * catches up with the server. The device's own settings (guest, signed out)
 * are kept aside while a profile has the store, and put back at sign-out.
 */
import { api } from "../api";
import { queryClient } from "../queries";
import { applyBindingOverrides, bindingOverrides, readBindings } from "../keybinds";
import { isRecord, likeTemplate, storedJson, strings } from "../parse";
import { getPrefs, readPrefs, setPrefs, SYNCED_PREFS, type Prefs } from "../prefs";
import type { Settings } from "../types";
import { AccountError, type AccountBackend } from "./backend";
import { keys } from "../queryKeys";

/** Settings keys that describe this machine, not the person. */
const DEVICE_ONLY = new Set<string>(["metadataSource"]);

interface Doc {
  settings: Partial<Settings>;
  keybinds: Record<string, string[]>;
  prefs: Partial<Prefs>;
  /** Missing in a doc that never carried addons: those on the device stay. */
  addons?: string[];
}

interface Saved {
  /** The document as last agreed with the server. */
  doc: Doc;
  /** Its `updatedAt` there. */
  at: number;
  /** Addon URLs from the doc that couldn't be installed here (yet). */
  missing: string[];
}

const storageKey = (space: string) => `polar.settingsSync.${space}`;

function load(space: string): Saved | null {
  const v = storedJson(localStorage, storageKey(space));
  if (!isRecord(v) || !isRecord(v.doc)) return null;
  return { doc: readDoc(v.doc), at: typeof v.at === "number" ? v.at : 0, missing: strings(v.missing) };
}

/**
 * A document from the server or this device's copy, another version's included, as far as it
 * fits (critique M9). Settings are checked against this device's own when applied.
 */
function readDoc(v: Record<string, unknown>): Doc {
  return {
    settings: isRecord(v.settings) ? (v.settings as Partial<Settings>) : {},
    keybinds: readBindings(v.keybinds) as Record<string, string[]>,
    prefs: readPrefs(v.prefs),
    ...(Array.isArray(v.addons) && { addons: strings(v.addons) }),
  };
}
const save = (space: string, s: Saved) => localStorage.setItem(storageKey(space), JSON.stringify(s));
export const forgetSettings = (space: string) => localStorage.removeItem(storageKey(space));

/** True while a synced doc is being written locally, so it isn't pushed straight back. */
export let applying = false;

async function current(missing: string[]): Promise<Doc> {
  const [settings, addons] = await Promise.all([api.settings(), api.addons()]);
  const prefs = getPrefs();
  return {
    settings: Object.fromEntries(Object.entries(settings).filter(([k]) => !DEVICE_ONLY.has(k))) as Partial<Settings>,
    keybinds: bindingOverrides() as Record<string, string[]>,
    prefs: Object.fromEntries(SYNCED_PREFS.map((k) => [k, prefs[k]])),
    addons: [...new Set([...addons.map((a) => a.manifestUrl), ...missing])].sort(),
  };
}

/** Write `doc` over this device's settings. Returns addon URLs that didn't install. */
async function apply(doc: Doc): Promise<string[]> {
  applying = true;
  try {
    queryClient.setQueryData(["settings"], await saveSynced(doc.settings));
    applyBindingOverrides(doc.keybinds);
    const prefs = Object.fromEntries(SYNCED_PREFS.filter((k) => k in doc.prefs).map((k) => [k, doc.prefs[k]]));
    setPrefs(prefs, { quiet: true });

    if (!Array.isArray(doc.addons)) return [];
    const wanted = new Set(doc.addons);
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
  } finally {
    applying = false;
  }
}

/**
 * Synced settings over this device's: only keys it knows, each of the kind it has here. When the
 * store still refuses them (a value another version allows), they go in one at a time and the
 * ones it refuses are left out, so a bad value can't stop the rest on every run.
 */
async function saveSynced(synced: Partial<Settings>): Promise<Settings> {
  const local = await api.settings();
  const wanted = Object.entries(likeTemplate(local, synced)).filter(([k]) => !DEVICE_ONLY.has(k));
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
 * back at sign-out (critique M12), then hand the store to the profile.
 */
export async function keepDeviceSettings(space: string) {
  if (localStorage.getItem(OWNER_KEY) === DEVICE) {
    const missing = load(DEVICE)?.missing ?? [];
    save(DEVICE, { doc: await current(missing), at: 0, missing });
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
  const local = await current(saved?.missing ?? []);

  const push = async () => {
    const at = Date.now();
    await backend.settings.put(space, { data: local as unknown as Record<string, unknown>, updatedAt: at });
    save(space, { doc: local, at, missing: saved?.missing ?? [] });
  };
  const take = async (r: { data: Record<string, unknown>; updatedAt: number }) => {
    const doc = readDoc(r.data);
    const missing = await apply(doc);
    save(space, { doc, at: r.updatedAt, missing });
  };

  // First time this profile is used on this device: the account's copy wins;
  // a brand-new profile starts from this device's settings.
  if (!saved) return remote ? take(remote) : push();

  const changedHere = stable(local) !== stable(saved.doc);
  // Edited here since the last sync: that's the newest write (sync runs
  // seconds after a change), so it wins over anything older on the server.
  if (changedHere) return push();
  if (!remote) return push();
  if (remote.updatedAt > saved.at) return take(remote);
}

/** JSON with sorted keys, so equal documents compare equal. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );
}
