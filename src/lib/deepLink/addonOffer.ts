/**
 * An add-on's install link from outside (#163): the add-on's name, description and address are
 * shown with Install and Cancel (components/StremioLinks.tsx), and it's installed only when the
 * user presses Install, never by the link itself (AGENTS.md rule 2). The address isn't logged:
 * it can carry the add-on's settings, keys included.
 *
 * Also the short notes a link from outside can leave (a link Polarity doesn't understand).
 */
import { useSyncExternalStore } from "react";
import type { Manifest } from "../types";

export type AddonOffer =
  | { id: number; step: "loading"; manifestUrl: string }
  | { id: number; step: "confirm" | "installing"; manifestUrl: string; name: string; description?: string }
  | { id: number; step: "error"; manifestUrl: string; error: string };

export interface OfferDeps {
  /** Reads the manifest without installing (`addon_preview`). */
  preview: (url: string) => Promise<Pick<Manifest, "name" | "description">>;
  install: (url: string) => Promise<unknown>;
}

let offer: AddonOffer | null = null;
let note: { id: number; text: string } | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

const set = (next: AddonOffer | null) => {
  offer = next;
  changed();
};

/** The manifest's words are the add-on's own: kept to a card's length. */
const clip = (text: string | undefined, max: number) => (text && text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const describe = (e: unknown) =>
  e && typeof e === "object" && "message" in e && typeof e.message === "string" && e.message ? e.message : "Couldn't reach the add-on.";

/** Shows the add-on behind `manifestUrl`, to install or not; a newer link replaces one still asking. */
export function offerAddon(manifestUrl: string, deps: OfferDeps) {
  const id = nextId++;
  set({ id, step: "loading", manifestUrl });
  void deps.preview(manifestUrl).then(
    (m) =>
      offer?.id === id &&
      set({ id, step: "confirm", manifestUrl, name: clip(m.name?.trim(), 80) || "Unnamed add-on", description: clip(m.description?.trim(), 500) || undefined }),
    (e) => offer?.id === id && set({ id, step: "error", manifestUrl, error: describe(e) }),
  );
}

/**
 * Install pressed on the card showing offer `id`. Resolves with the add-on's name once installed. A newer link
 * may have replaced that offer just before the press: then nothing is installed.
 */
export async function confirmAddon(id: number, deps: OfferDeps): Promise<string | null> {
  const asked = offer;
  if (asked?.step !== "confirm" || asked.id !== id) return null;
  set({ ...asked, step: "installing" });
  try {
    await deps.install(asked.manifestUrl);
  } catch (e) {
    if (offer?.id === asked.id) set({ id: asked.id, step: "error", manifestUrl: asked.manifestUrl, error: describe(e) });
    return null;
  }
  if (offer?.id === asked.id) set(null);
  return asked.name;
}

export function dismissAddonOffer() {
  set(null);
}

export const getAddonOffer = () => offer;

export const useAddonOffer = () => useSyncExternalStore(subscribe, getAddonOffer);

/** A short note from a link (shown for a few seconds as a toast). */
export function showLinkNote(text: string) {
  note = { id: nextId++, text };
  changed();
}

export function clearLinkNote(id: number) {
  if (note?.id !== id) return;
  note = null;
  changed();
}

export const useLinkNote = () => useSyncExternalStore(subscribe, () => note);
