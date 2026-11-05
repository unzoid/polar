#!/usr/bin/env bun
/**
 * Our own black-bar detector against FFmpeg's cropdetect, on a clip whose
 * bars are known (docs/autocrop.md).
 *
 *   bun scripts/autocrop-compare.ts <film> [--shots 8] [--seconds 8] [--out <folder>]
 *
 * Takes `--shots` shots from across the film (one without bars of its own,
 * such as Sintel or Tears of Steel: docs/screenshots.md), each `--seconds`
 * long, and frames each one at 1920x1080 as full frame, 2.39:1 letterboxed,
 * 1.85:1 letterboxed or 4:3 pillarboxed, so every cut changes the bars. Then
 * runs cropdetect (the settings Polarity's desktop player uses) and our
 * detector over the same frames, each through the same CropTracker, and
 * prints a table: how soon bars are cropped, how often the crop changes, and
 * frames that cut picture off or leave bars on screen; then how each crop change
 * would be shown (on the cut, followed, eased late, correcting a misread),
 * and per shot, the frames that cut picture off.
 *
 * Needs ffmpeg and ffprobe on PATH (a GPL build, for cropdetect) and Rust.
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FPS = 24;
const [W, H] = [1920, 1080];

/** How each shot is framed: its picture size and the bars around it. */
const FRAMINGS = {
  full: { w: 1920, h: 1080, v: 0, hz: 0 },
  scope: { w: 1920, h: 804, v: 138, hz: 0 }, // 2.39:1
  flat: { w: 1920, h: 1038, v: 21, hz: 0 }, // 1.85:1
  pillar: { w: 1440, h: 1080, v: 0, hz: 240 }, // 4:3
} as const;
const ORDER: (keyof typeof FRAMINGS)[] = ["full", "scope", "full", "scope", "flat", "pillar", "scope", "full"];

const args = Bun.argv.slice(2);
let film = "";
let shots = 8;
let seconds = 8;
let out = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--shots") shots = Number(args[++i]);
  else if (args[i] === "--seconds") seconds = Number(args[++i]);
  else if (args[i] === "--out") out = args[++i] ?? "";
  else if (!film && !args[i].startsWith("--")) film = args[i];
  else throw new Error(`unknown argument: ${args[i]}`);
}
if (!film) throw new Error("usage: bun scripts/autocrop-compare.ts <film> [--shots 8] [--seconds 8] [--out <folder>]");
if (!(shots >= 2 && seconds > 0)) throw new Error("--shots must be at least 2 and --seconds above 0");
out ||= await mkdtemp(join(tmpdir(), "autocrop-"));

async function run(cmd: string[]): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "inherit" });
  const text = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(`failed: ${cmd.join(" ")}`);
  return text;
}

const duration = Number(await run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", film]));
if (!(duration > shots * seconds)) throw new Error(`the film is ${duration} s: too short for ${shots} shots of ${seconds} s`);

const frames = Math.round(seconds * FPS);
const list: string[] = [];
const truth: string[] = [];
for (let i = 0; i < shots; i++) {
  const kind = ORDER[i % ORDER.length];
  const f = FRAMINGS[kind];
  const from = ((duration * (i + 1)) / (shots + 1)).toFixed(2);
  const vf = [
    `scale=${f.w}:${f.h}:force_original_aspect_ratio=increase`,
    `crop=${f.w}:${f.h}`,
    `pad=${W}:${H}:${f.hz}:${f.v}:black`,
    "setsar=1",
    `fps=${FPS}`,
    "format=yuv420p",
  ].join(",");
  const shot = join(out, `shot${i}.mp4`);
  console.error(`shot ${i + 1}/${shots}: ${kind} from ${from} s`);
  await run([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-ss",
    from,
    "-i",
    film,
    "-an",
    "-sn",
    "-dn",
    "-vf",
    vf,
    "-frames:v",
    String(frames),
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-preset",
    "veryfast",
    shot,
  ]);
  list.push(`file '${shot.replaceAll("'", "'\\''")}'`);
  truth.push(`${(i * frames) / FPS}:${f.v}:${f.hz}`);
}
await writeFile(join(out, "shots.txt"), list.join("\n") + "\n");
const clip = join(out, "clip.mp4");
await run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(out, "shots.txt"), "-c", "copy", clip]);

// cropdetect as Polarity's desktop player runs it (polar_player::crop::CROPDETECT).
const cropdetect = join(out, "cropdetect.txt");
await run([
  "ffmpeg",
  "-v",
  "error",
  "-i",
  clip,
  "-an",
  "-vf",
  `cropdetect=limit=0.09:round=2:reset=1,metadata=mode=print:file=${cropdetect}`,
  "-f",
  "null",
  "-",
]);

// Our detector reads full-range luma (black = 0), as mpv's screenshots are.
const decode = Bun.spawn(["ffmpeg", "-v", "error", "-i", clip, "-an", "-vf", "scale=in_range=tv:out_range=pc,format=gray", "-f", "rawvideo", "-"], {
  stdout: "pipe",
  stderr: "inherit",
});
const compare = Bun.spawn(
  [
    "cargo",
    "run",
    "--quiet",
    "--release",
    "-p",
    "polar-player",
    "--example",
    "autocrop_compare",
    "--",
    "--size",
    `${W}x${H}`,
    "--fps",
    String(FPS),
    "--truth",
    truth.join(","),
    "--cropdetect",
    cropdetect,
    // cropdetect's limit is about 23 on limited-range luma, ~8 steps above black in full range:
    // our detector at lower limits too, to see how much picture the default 24 cuts in dark shots.
    "--also-limits",
    "16,12,8",
  ],
  { stdin: decode.stdout, stdout: "inherit", stderr: "inherit" },
);
if ((await compare.exited) !== 0 || (await decode.exited) !== 0) throw new Error("the comparison failed");
console.error(`\nclip, cropdetect readings and shot list kept in ${out}`);
