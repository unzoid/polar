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
