import type { Page } from "@playwright/test";

/**
 * The fake shell's sources link to https://media.example/; this answers them
 * with a silent 90-second WAV made here (no file, no licence), with byte
 * ranges as a media server would.
 */
export function silentWav(seconds = 90, rate = 8000): Buffer {
  const n = rate * seconds;
  const wav = Buffer.alloc(44 + n);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + n, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(n, 40);
  wav.fill(128, 44); // 8-bit silence
  return wav;
}

export async function serveMedia(page: Page): Promise<void> {
  const wav = silentWav();
  await page.route("https://media.example/**", (route) => {
    const range = route.request().headers().range;
    const headers = { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*" };
    if (!range) return route.fulfill({ status: 200, headers, body: wav });
    const [a, z] = range.replace("bytes=", "").split("-");
    const start = Number(a);
    const end = z ? Number(z) : wav.length - 1;
    return route.fulfill({
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${wav.length}` },
      body: wav.subarray(start, end + 1),
    });
  });
}
