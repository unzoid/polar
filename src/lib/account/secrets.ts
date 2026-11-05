/**
 * API keys and add-on links sealed with a passphrase, for the `syncSecrets` option (off; docs/
 * supabase-storage.md §3.7). The account only ever holds the sealed text: without the passphrase,
 * typed on each device and never sent, it is random bytes.
 *
 *   "s1." + base64(salt 16 B) + "." + base64(nonce 12 B) + "." + base64(AES-256-GCM ciphertext + tag)
 *   key = PBKDF2-SHA-256(passphrase, salt, 600,000 rounds), OWASP's figure for SHA-256
 *   (cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
 *
 * Plain WebCrypto, which the app's webview and Bun both have: no new dependency.
 */

export interface Secrets {
  /** Settings keys (tmdbKey, omdbKey, …) and their values; a missing key means not set. */
  keys: Record<string, string>;
  /** Add-on manifest URLs, sorted. */
  addons: string[];
}

const PREFIX = "s1";
const ROUNDS = 600_000;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function keyFor(passphrase: string, salt: Uint8Array<ArrayBuffer>, rounds = ROUNDS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, base, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** `rounds` only for tests: the stored format always uses ROUNDS. */
export async function seal(passphrase: string, secrets: Secrets, rounds = ROUNDS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(secrets));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await keyFor(passphrase, salt, rounds), plain));
  return [PREFIX, b64(salt), b64(nonce), b64(sealed)].join(".");
}

/** What `seal` sealed, or `null`: a wrong passphrase, damaged text or another format. */
export async function open(passphrase: string, text: string, rounds = ROUNDS): Promise<Secrets | null> {
  const parts = text.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const [salt, nonce, sealed] = parts.slice(1).map(unb64);
    if (salt.length !== 16 || nonce.length !== 12) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await keyFor(passphrase, salt, rounds), sealed);
    const v: unknown = JSON.parse(new TextDecoder().decode(plain));
    if (!v || typeof v !== "object") return null;
    const { keys, addons } = v as Record<string, unknown>;
    if (!keys || typeof keys !== "object" || Array.isArray(keys) || !Array.isArray(addons)) return null;
    return {
      keys: Object.fromEntries(Object.entries(keys).filter((e): e is [string, string] => typeof e[1] === "string")),
      addons: addons.filter((a): a is string => typeof a === "string"),
    };
  } catch {
    return null;
  }
}
