import type { MetaPreview } from "../types";

/**
 * Titles added to or removed from the library by hand (the Library buttons and card menus), for
 * what follows the library elsewhere (the Trakt watchlist, #85) without the library knowing it.
 */
type Listener = (item: MetaPreview, inLibrary: boolean) => void;

const listeners = new Set<Listener>();

export function onLibraryToggle(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function libraryToggled(item: MetaPreview, inLibrary: boolean) {
  listeners.forEach((l) => l(item, inLibrary));
}
