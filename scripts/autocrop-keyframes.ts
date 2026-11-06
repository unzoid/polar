#!/usr/bin/env bun
/**
 * Autocrop's lookahead and keyframes (docs/autocrop.md §4, "Checking it").
 *
 *   bun scripts/autocrop-keyframes.ts make <out.mkv>
 *     An invented test episode: 120 synthetic shots at 24 fps, each full
 *     frame or letterboxed (2.40:1 or 2.20:1) unlike the one before, every
 *     eighth under a second long, encoded with long keyframe intervals as
 *     x264 does for anime (keyint 250, min-keyint 24), so most cuts are
 *     keyframes and the ones right after a short shot aren't. Writes the
 *     cuts and their bars to <out.mkv>.cuts.json.
 *
 *   bun scripts/autocrop-keyframes.ts measure <video>
 *     For any video: its bar changes (cropdetect as the desktop player runs
 *     it, a change counted once the new bars hold for half a second) and how
 *     many of them fall on a keyframe, which is what the lookahead reads.
 *
 *   bun scripts/autocrop-keyframes.ts score <out.mkv.cuts.json> <polarity log>
 *     After playing the test episode in Polarity from the start, with autocrop
 *     on: the share of the cuts where the crop changed on the cut frame, from
 *     the player's "autocrop: bars …" log lines, and which rule made each change.
 *
 * Needs ffmpeg and ffprobe on PATH (a GPL build, for libx264 and cropdetect).
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FPS = 24;
const [W, H] = [1920, 1080];
/** Bars top and bottom, in pixels, of each kind of shot. */
const BARS = [0, 140, 100];
/** Synthetic pictures (FFmpeg's lavfi sources and their options), one per shot in turn, so each cut changes the whole picture. */
const SOURCES = [
  ["testsrc2", ""],
  ["mandelbrot", ""],
  ["rgbtestsrc", ""],
  ["cellauto", "rule=110"],
  ["life", "mold=10:ratio=0.2"],
  ["smptehdbars", ""],
];

async function run(cmd: string[]): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "inherit" });
  const text = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(`failed: ${cmd.join(" ")}`);
  return text;
}

interface Cut {
  /** The first frame of the new shot, and its time in seconds. */
  frame: number;
  time: number;
  bars: number;
}

/** The same shot list as `polar_player::lookahead`'s simulated episode, from the same generator. */
function shots(): { bars: number; frames: number }[] {
  let seed = 7;
  const rnd = (n: number) => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 16) % n;
  };
  const list: { bars: number; frames: number }[] = [];
  let bars = 0;
  for (let shot = 0; shot < 120; shot++) {
    if (shot > 0) bars = BARS.filter((b) => b !== bars)[rnd(2)];
    list.push({ bars, frames: shot % 8 === 7 ? 8 + rnd(13) : 40 + rnd(161) });
  }
  return list;
}

async function make(out: string) {
  const list = shots();
  // Each shot losslessly on its own, then all of them encoded in one go, so the encoder places the keyframes.
  const dir = await mkdtemp(join(tmpdir(), "autocrop-keyframes-"));
  const files: string[] = [];
  for (const [i, s] of list.entries()) {
    const pic = H - 2 * s.bars;
    const [name, opts] = SOURCES[i % SOURCES.length];
    const file = join(dir, `shot${i}.mkv`);
    console.error(`shot ${i + 1}/${list.length}: ${s.frames} frames, ${s.bars} px bars`);
    await run([
      "ffmpeg",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `${name}=size=${W}x${pic}:rate=${FPS}${opts ? `:${opts}` : ""}`,
      "-vf",
      `pad=${W}:${H}:0:${s.bars}:black,setsar=1,format=yuv420p`,
      "-frames:v",
      String(s.frames),
      "-c:v",
      "libx264",
      "-qp",
      "0",
      "-preset",
      "ultrafast",
      file,
    ]);
    files.push(`file '${file.replaceAll("'", "'\\''")}'`);
  }
  await writeFile(join(dir, "shots.txt"), files.join("\n") + "\n");
  await run([
    "ffmpeg",
    "-v",
    "error",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    join(dir, "shots.txt"),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-x264-params",
    "keyint=250:min-keyint=24:scenecut=40",
    out,
  ]);
  await rm(dir, { recursive: true, force: true });
  const cuts: Cut[] = [];
  let frame = 0;
  list.forEach((s, i) => {
    if (i > 0) cuts.push({ frame, time: frame / FPS, bars: s.bars });
    frame += s.frames;
  });
  await writeFile(`${out}.cuts.json`, JSON.stringify({ fps: FPS, cuts }, null, 1) + "\n");
  const keys = await keyframes(out);
  const onKey = cuts.filter((c) => keys.some((k) => Math.abs(k - c.time) < 0.5 / FPS)).length;
  console.log(`${out}: ${cuts.length} cuts, ${onKey} on a keyframe, ${cuts.length - onKey} between keyframes`);
}

/** The video's keyframe times in seconds, from its packets (nothing decoded). */
async function keyframes(video: string): Promise<number[]> {
  const text = await run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", video]);
  return text
    .split("\n")
    .map((l) => l.split(","))
    .filter(([t, flags]) => flags?.startsWith("K") && t !== "N/A")
    .map(([t]) => Number(t))
    .sort((a, b) => a - b);
}

async function measure(video: string) {
  const keys = await keyframes(video);
  // cropdetect as Polarity's desktop player runs it (polar_player::crop::CROPDETECT).
  const text = await run([
    "ffmpeg",
    "-v",
    "error",
    "-i",
    video,
    "-map",
    "0:v:0",
    "-vf",
    "cropdetect=limit=0.09:round=2:reset=1,metadata=mode=print:file=-",
    "-f",
    "null",
    "-",
  ]);
  const height = Number(await run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height", "-of", "csv=p=0", video]));
  // Each frame's bars top and bottom, if even (none: picture to the edges; null: a black or uneven frame).
  const frames: { time: number; bars: number | null }[] = [];
  let time = NaN;
  let rect: Record<string, number> = {};
  const flush = () => {
    if (Number.isFinite(time) && rect.y !== undefined && rect.h !== undefined && rect.h > 0) {
      const [top, bottom] = [rect.y, height - rect.y - rect.h];
      const bars = Math.abs(top - bottom) <= 8 ? Math.min(top, bottom) : null;
      frames.push({ time, bars: bars !== null && bars * 100 < height ? 0 : bars });
    }
    rect = {};
  };
  for (const line of text.split("\n")) {
    const pts = line.match(/pts_time:([\d.]+)/);
    if (pts) {
      flush();
      time = Number(pts[1]);
      continue;
    }
    const kv = line.match(/lavfi\.cropdetect\.(\w+)=(-?\d+)/);
    if (kv) rect[kv[1]] = Number(kv[2]);
  }
  flush();
  // A change: new bars that then hold (within 4 px) for 12 frames, timed at their first frame.
  const changes: number[] = [];
  let held: number | null = null;
  for (let i = 0; i + 12 <= frames.length; i++) {
    const b = frames[i].bars;
    if (b === null || (held !== null && Math.abs(b - held) <= 4)) continue;
    if (frames.slice(i, i + 12).every((f) => f.bars !== null && Math.abs(f.bars - b) <= 4)) {
      if (held !== null) changes.push(frames[i].time);
      held = b;
    }
  }
  const frame = frames.length > 1 ? frames[1].time - frames[0].time : 1 / FPS;
  const onKey = changes.filter((t) => keys.some((k) => Math.abs(k - t) < frame / 2));
  const gaps = keys.slice(1).map((k, i) => k - keys[i]);
  console.log(
    `keyframes: ${keys.length}, ${(gaps.reduce((a, b) => a + b, 0) / Math.max(gaps.length, 1)).toFixed(2)} s apart on average, ${Math.max(0, ...gaps).toFixed(2)} s at most`,
  );
  console.log(`bar changes: ${changes.length}, on a keyframe: ${onKey.length}, between keyframes: ${changes.length - onKey.length}`);
  for (const t of changes) console.log(`  ${t.toFixed(3)} s ${onKey.includes(t) ? "keyframe" : "between keyframes"}`);
}

async function score(cutsFile: string, log: string) {
  const { fps, cuts } = JSON.parse(await readFile(cutsFile, "utf8")) as { fps: number; cuts: Cut[] };
  // "autocrop: bars 140/0 px from 12.375 s, on the cut: jump (lookahead, keyframe)"
  const changes = (await readFile(log, "utf8"))
    .split("\n")
    .map((l) => l.match(/autocrop: bars (\d+)\/(\d+) px from ([\d.]+) s, (.+)$/))
    .filter((m) => m !== null)
    .map((m) => ({ bars: Number(m[1]), time: Number(m[3]), rule: m[4].trim() }));
  if (changes.length === 0) throw new Error("no autocrop lines in the log: play the test episode with autocrop on first");
  const rules = new Map<string, number>();
  let landed = 0;
  for (const c of cuts) {
    const on = changes.find((x) => Math.abs(x.time - c.time) < 0.5 / fps && Math.abs(x.bars - c.bars) <= 4);
    if (on?.rule.startsWith("on the cut")) landed++;
    const rule = on ? on.rule : "not on the cut frame";
    rules.set(rule, (rules.get(rule) ?? 0) + 1);
  }
  console.log(`${landed} of ${cuts.length} cuts (${((100 * landed) / cuts.length).toFixed(1)}%) changed the crop on the cut frame`);
  for (const [rule, n] of [...rules].sort((a, b) => b[1] - a[1])) console.log(`  ${n} ${rule}`);
}

const [command, a, b] = Bun.argv.slice(2);
if (command === "make" && a) await make(a);
else if (command === "measure" && a) await measure(a);
else if (command === "score" && a && b) await score(a, b);
else throw new Error("usage: bun scripts/autocrop-keyframes.ts make <out.mkv> | measure <video> | score <out.mkv.cuts.json> <polarity log>");
