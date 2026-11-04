/**
 * "Something the profile's synced settings cover just changed" (settings,
 * shortcuts, addons). Dependency-free so api.ts, keybinds.ts and prefs.ts can
 * all raise it; account/sync.ts listens and pushes soon.
 */
const listeners = new Set<() => void>();

export function onSettingsChange(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}

export const settingsChanged = () => listeners.forEach((l) => l());
