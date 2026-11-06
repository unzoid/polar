import type { AccountError } from "./backend";

/**
 * The account had no room left for a kind of row (#110: `library_limit`, `progress_limit`…). Sync
 * keeps trying every round; the user is told once a session per kind (AccountFullToast).
 */
type Listener = (e: AccountError) => void;
const listeners = new Set<Listener>();
const told = new Set<string>();

/** Hear each kind the account ran out of room for; returns the function that stops listening. */
export function onAccountFull(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function noteAccountFull(e: AccountError): void {
  if (told.has(e.code)) return;
  told.add(e.code);
  listeners.forEach((l) => l(e));
}
