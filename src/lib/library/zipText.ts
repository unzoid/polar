/**
 * Reading text files out of a ZIP the user picked (#87: Letterboxd's export), on the device, with
 * the web view's own DecompressionStream: no library. Only what such an export uses: stored and
 * deflated entries, no ZIP64, no encryption. Sizes are bounded so a crafted file can't fill memory.
 */

/** The most one entry may hold once inflated. Letterboxd's CSV files are far smaller. */
export const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
/** The most entries the central directory may list. */
export const MAX_ENTRIES = 10_000;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export class ZipError extends Error {}

function endOfDirectory(view: DataView): number {
  // The end record is 22 bytes plus a comment of up to 65,535.
  const last = view.byteLength - 22;
  for (let i = last; i >= Math.max(0, last - 0xffff); i--) if (view.getUint32(i, true) === EOCD) return i;
  throw new ZipError("This file isn't a ZIP archive.");
}

async function inflateRaw(bytes: Uint8Array<ArrayBuffer>, limit: number): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new ZipError("A file in this ZIP is larger than it says.");
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The entries `wanted` picks (by their full path inside the archive), as UTF-8 text. Folders,
 * encrypted entries and other compression methods are left out. Throws `ZipError` when the file isn't
 * a ZIP, is damaged, or holds a picked entry too large to read.
 */
export async function zipText(data: Uint8Array<ArrayBuffer>, wanted: (path: string) => boolean): Promise<Map<string, string>> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.byteLength < 22) throw new ZipError("This file isn't a ZIP archive.");
  const end = endOfDirectory(view);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new ZipError("This ZIP is too large to read here.");
  if (count > MAX_ENTRIES) throw new ZipError("This ZIP holds too many files.");
  const names = new TextDecoder();
  const text = new TextDecoder("utf-8");
  const out = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL) throw new ZipError("This ZIP is damaged.");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const skip = nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const path = names.decode(data.subarray(at + 46, at + 46 + nameLength));
    at += 46 + skip;
    if (path.endsWith("/") || flags & 1 || (method !== 0 && method !== 8) || !wanted(path)) continue;
    if (size > MAX_ENTRY_BYTES) throw new ZipError(`${path} is too large to read.`);
    if (local + 30 > data.length || view.getUint32(local, true) !== LOCAL) throw new ZipError("This ZIP is damaged.");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > data.length) throw new ZipError("This ZIP is damaged.");
    const body = data.subarray(start, start + packed);
    let bytes: Uint8Array;
    try {
      bytes = method === 0 ? body : await inflateRaw(body, size);
    } catch (e) {
      throw e instanceof ZipError ? e : new ZipError("This ZIP is damaged.");
    }
    out.set(path, text.decode(bytes));
  }
  return out;
}
