/**
 * Which desktop the app runs on, for the few places it differs: macOS keeps
 * its own traffic-light window buttons (Windows draws ours), and shortcuts
 * use ⌘ there instead of Ctrl.
 */
export const isMac = /Mac/i.test(navigator.platform || navigator.userAgent);

/** The shortcut modifier, as stored in bindings ("Ctrl+k" / "Meta+k"). */
export const MOD = isMac ? "Meta" : "Ctrl";

/** ...and as people read it. */
export const MOD_LABEL = isMac ? "⌘" : "Ctrl";
