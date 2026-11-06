/**
 * Whether an add-on link carries a key (#195): many add-ons that need an account somewhere take the
 * user's key or a token in the link itself, in a query parameter or in the path (often a long token
 * or a base64 config). Only the link's shape is looked at, on this device: nothing is sent anywhere.
 */

/** Parameter and config field names that hold a key or a password. */
const KEY_NAME = /^(?:api[-_]?key|apikey|key|token|access[-_]?token|auth|authorization|secret|password|passwd|pass|pwd|sig|signature|session|sid)$|(?:key|token|secret|password)$/i;

/**
 * A run of characters that reads as a token: long, no spaces, letters and digits mixed through it
 * (a random key, a UUID), not words with a number ("catalog-2024-movies").
 */
function tokenLike(text: string): boolean {
  if (text.length < 20 || !/^[A-Za-z0-9._~+/=%-]+$/.test(text)) return false;
  const switches = text.match(/[A-Za-z](?=\d)|\d(?=[A-Za-z])/g)?.length ?? 0;
  return switches >= 4;
}

/** `text` as base64 or base64url, when it is that and decodes to text. */
function unbase64(text: string): string | null {
  if (text.length < 8 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) return null;
  try {
    const bytes = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return /^[\t\n\r\x20-\x7e\x80-\xff]*$/.test(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A config (JSON or `a=1&b=2|c=3`) with a key-named field set, or a token among its values. */
function configHasKey(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return valueHasKey(JSON.parse(trimmed));
    } catch {
      // Not JSON after all: read it as pairs below.
    }
  }
  return trimmed.split(/[&|;,]/).some((pair) => {
    const at = pair.indexOf("=");
    if (at < 0) return tokenLike(pair);
    const [name, value] = [pair.slice(0, at).trim(), pair.slice(at + 1).trim()];
    return (!!value && KEY_NAME.test(name)) || tokenLike(value);
  });
}

function valueHasKey(v: unknown, name = ""): boolean {
  if (typeof v === "string") return (!!v && KEY_NAME.test(name)) || tokenLike(v);
  if (Array.isArray(v)) return v.some((x) => valueHasKey(x, name));
  if (v && typeof v === "object") return Object.entries(v).some(([k, x]) => valueHasKey(x, k));
  return false;
}

/** One part of the link (a path segment or a parameter's value), decoded. */
function partHasKey(raw: string): boolean {
  const text = decode(raw);
  if (!text) return false;
  // A base64 config is judged by what it holds, not by how random it looks.
  const inner = unbase64(text);
  if (inner && /^\s*[[{]|=/.test(inner)) return configHasKey(inner);
  if (tokenLike(text)) return true;
  return /[={]/.test(text) && configHasKey(text);
}

/** True when `link` looks like it holds a key, a token or a password. */
export function linkHasKey(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return false;
  }
  if (url.username || url.password) return true;
  for (const [name, value] of url.searchParams) {
    if ((value && KEY_NAME.test(name)) || partHasKey(value)) return true;
  }
  if (url.hash.length > 1 && partHasKey(url.hash.slice(1))) return true;
  return url.pathname.split("/").some((segment) => partHasKey(segment));
}
