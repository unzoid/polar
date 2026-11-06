/**
 * What the app says while a profile's API keys and keyed add-on links sync without a passphrase
 * (#195), readable by the account server: Settings → Account's notice until it's dismissed (back
 * when a new key or keyed link arrives), and a one-time notice at a device's first sync.
 *
 * Only names are kept here (a setting's name, an add-on's id), never a key or a link.
 */
import { storeLocal } from "../errors";
import { storedJson } from "../parse";
import { linkHasKey } from "./keyedLink";
import type { Secrets } from "./secrets";

/** The names of what would be exposed: each key that's set, each add-on whose link holds a key. */
export function exposedNames(keys: Record<string, unknown>, addons: { id: string; url: string }[]): string[] {
  return [
    ...Object.entries(keys).flatMap(([k, v]) => (typeof v === "string" && v ? [`key:${k}`] : [])),
    ...addons.flatMap((a) => (linkHasKey(a.url) ? [`addon:${a.id}`] : [])),
  ].sort();
}

/** True when `secrets` hold a key or a keyed add-on link. */
export const secretsExposed = (secrets: Secrets | undefined): boolean =>
  !!secrets && (Object.values(secrets.keys).some(Boolean) || secrets.addons.some(linkHasKey));

const seenKey = (space: string) => `polar.secretsNoticeSeen.${space}`;
const toldKey = (space: string) => `polar.secretsSyncTold.${space}`;

/** Whether Settings → Account shows its notice: something is exposed that wasn't when it was last dismissed. */
export function noticeDue(space: string, exposed: string[]): boolean {
  const seen = storedJson(localStorage, seenKey(space));
  const known = new Set(Array.isArray(seen) ? seen : []);
  return exposed.some((name) => !known.has(name));
}

/** The notice dismissed: it stays away until a key or keyed link not in `exposed` is added. */
export function dismissNotice(space: string, exposed: string[]) {
  storeLocal(seenKey(space), JSON.stringify(exposed));
}

type Listener = (space: string) => void;
const listeners = new Set<Listener>();

/** Hear a device's first sync of exposed keys for a profile; returns the function that stops listening. */
export function onFirstPlainSync(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A device's first round for `space` sends keys without a passphrase: said once per profile on this device. */
export function noteFirstPlainSync(space: string) {
  if (localStorage.getItem(toldKey(space))) return;
  storeLocal(toldKey(space), "1");
  listeners.forEach((l) => l(space));
}

/** Signing out of a profile on this device forgets what it was told. */
export function forgetNotices(space: string) {
  localStorage.removeItem(seenKey(space));
  localStorage.removeItem(toldKey(space));
}
