import { isRecord } from "./parse";

/**
 * How a Rust command fails (src-tauri/src/commands.rs `CmdError`): `code` for the app to act on,
 * `message` for people. The mpv commands other than `mpv_load` still fail with a bare string.
 */
export interface CommandError {
  code: CommandErrorCode;
  message: string;
}

export type CommandErrorCode =
  /** What was asked for isn't there (any more). */
  | "not_found"
  /** Not something Polar does: an id it doesn't key by, a link it won't open. */
  | "unsupported"
  /** The addon couldn't be reached. */
  | "network"
  /** The addon answered with something that isn't the addon protocol. */
  | "bad_answer"
  /** A metadata or web service (Cinemeta, TMDB, Seekr, IntroDB) failed or said no. */
  | "upstream"
  /** Writing to disk failed. */
  | "save_failed"
  /** The link check found the source won't play. */
  | "source"
  /** The player (mpv) didn't start or answer. */
  | "player"
  | "other";

/** What to tell people about any failure: a command's, an account's, a thrown Error or a bare string. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (isRecord(e) && typeof e.message === "string") return e.message;
  return String(e);
}

/** The failure's code, from a command (`CommandErrorCode`) or the account backend (`AccountErrorCode`); none for others. */
export function errorCode(e: unknown): string | undefined {
  return isRecord(e) && typeof e.code === "string" ? e.code : undefined;
}

/** A `.catch` for work that may fail without stopping anything, but shouldn't fail unseen: says what failed in the console. */
export const warnFailed = (what: string) => (e: unknown) => console.warn(`${what} failed:`, errorMessage(e));

// --- Save failures ----------------------------------------------------------
// A change that couldn't be written must never fail unseen (test report 1, item 3): every
// command goes through api.ts, which reports `save_failed` here, and so do writes to the
// web view's own storage (storeLocal). The app shows one toast for them (SaveProblemToast).

type SaveListener = (message: string) => void;
const saveListeners = new Set<SaveListener>();

/** Hear every failed save, with what went wrong; returns the function that stops listening. */
export function onSaveFailure(listener: SaveListener): () => void {
  saveListeners.add(listener);
  return () => saveListeners.delete(listener);
}

/** What went wrong, without the "could not save:" / "not saved:" the native side wraps it in. */
export const saveFailureText = (message: string) => message.replace(/^(could not save: )?(not saved: )?/i, "");

/** Tells the listeners when `e` is a command's `save_failed`; other failures are left to the caller. */
export function noteSaveFailure(e: unknown): void {
  if (errorCode(e) !== "save_failed") return;
  const message = saveFailureText(errorMessage(e));
  saveListeners.forEach((l) => l(message));
}

/** `storage.setItem` that reports a full or refused store as a failed save instead of throwing; true when it was written. */
export function storeLocal(key: string, value: string, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): boolean {
  try {
    storage?.setItem(key, value);
    return true;
  } catch (e) {
    const message = errorMessage(e);
    saveListeners.forEach((l) => l(message));
    return false;
  }
}
