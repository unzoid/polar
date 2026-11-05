import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * The one channel between the screens and the native side: commands it answers
 * (src-tauri/src/commands.rs and the modules it names) and events it sends.
 * Tauri carries it on every platform Polarity targets, desktop and mobile; a shell
 * without Tauri replaces this file and nothing above it.
 */

/** Running inside the native shell (not a plain browser tab, as with `vite dev` alone). */
export const inShell = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Run a native command and get its answer; failures reject with the command's `{ code, message }` (lib/errors.ts). */
export const call = <T = unknown>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

export type Unlisten = () => void;

/** Hear a native event until the returned function is called. Resolves once listening. */
export const on = <T>(event: string, handler: (payload: T) => void): Promise<Unlisten> => listen<T>(event, (e) => handler(e.payload));

/**
 * The address of `path` on one of the shell's own protocols (`trailer`: src-tauri/src/trailer_proxy.rs),
 * written the way this platform's web view expects it; none outside the shell.
 */
export function shellUrl(protocol: string, path: string): string | null {
  const internals = typeof window !== "undefined" ? (window as { __TAURI_INTERNALS__?: { convertFileSrc?: unknown } }).__TAURI_INTERNALS__ : undefined;
  return typeof internals?.convertFileSrc === "function" ? convertFileSrc(path, protocol) : null;
}
