import type { ContentType } from "./types";

/**
 * A playlist's titles as bytes, for storage (and later, share links).
 *
 *   [version = 1] then per title: [tag] [payload]
 *   tag bit 0: series (else movie)
 *   tag bit 1: IMDb id — payload is the number after "tt" as a varint
 *              (tt0000100 → 3 bytes); otherwise a varint length + UTF-8 id.
 *
 * So a typical title is 4–5 bytes, and 100 titles fit in under half a KB.
 */
export interface PlaylistRef {
  id: string;
  type: ContentType;
}

const VERSION = 1;
const SERIES = 1;
const IMDB = 2;
const IMDB_ID = /^tt(\d{1,15})$/;

function pushVarint(out: number[], n: number) {
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
}

export function encodeItems(items: PlaylistRef[]): Uint8Array {
  const out: number[] = [VERSION];
  const text = new TextEncoder();
  for (const item of items) {
    const series = item.type === "series" ? SERIES : 0;
    const imdb = IMDB_ID.exec(item.id);
    // Leading zeros matter ("tt0000100"): only ids that round-trip go numeric.
    if (imdb && `tt${Number(imdb[1]).toString().padStart(7, "0")}` === item.id) {
      out.push(series | IMDB);
      pushVarint(out, Number(imdb[1]));
    } else {
      const bytes = text.encode(item.id);
      out.push(series);
      pushVarint(out, bytes.length);
      out.push(...bytes);
    }
  }
  return Uint8Array.from(out);
}

export function decodeItems(bytes: Uint8Array): PlaylistRef[] {
  if (bytes[0] !== VERSION) return [];
  const items: PlaylistRef[] = [];
  const text = new TextDecoder();
  let i = 1;
  const varint = () => {
    let n = 0;
    let scale = 1;
    while (i < bytes.length) {
      const b = bytes[i++];
      n += (b & 0x7f) * scale;
      if (b < 0x80) return n;
      scale *= 0x80;
    }
    throw new Error("truncated playlist");
  };
  try {
    while (i < bytes.length) {
      const tag = bytes[i++];
      const type: ContentType = tag & SERIES ? "series" : "movie";
      if (tag & IMDB) {
        items.push({ id: `tt${varint().toString().padStart(7, "0")}`, type });
      } else {
        const len = varint();
        items.push({ id: text.decode(bytes.subarray(i, i + len)), type });
        i += len;
      }
    }
  } catch {
    // Keep what decoded cleanly.
  }
  return items;
}

/** Postgres bytea over PostgREST travels as "\x" + hex. */
export const toHex = (bytes: Uint8Array) =>
  "\\x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function fromHex(hex: string): Uint8Array {
  const h = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
