import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import { MpvMedia } from "../../src/components/player/mpvMedia";

const commands: unknown[][] = [];

const property = (name: string, data: unknown) => emit("mpv://property", { name, data });

async function media() {
  const m = new MpvMedia();
  await m.attach();
  await property("duration", 600);
  await property("time-pos", 100);
  await property("pause", true);
  return m;
}

describe("seeking in mpv", () => {
  beforeEach(() => {
    commands.length = 0;
    mockIPC((cmd, args) => {
      if (cmd === "mpv_command") commands.push((args as { args: unknown[] }).args);
    }, { shouldMockEvents: true });
  });

  afterEach(() => clearMocks());

  test("every seek is to the exact place, not the keyframe before it", async () => {
    const m = await media();
    m.currentTime = 110;
    expect(commands.at(-1)).toEqual(["seek", 110, "absolute+exact"]);
  });

  test("skipping forward then straight back goes back to where it started", async () => {
    const m = await media();
    m.currentTime = m.currentTime + 10;
    m.currentTime = m.currentTime - 10;
    expect(commands.map((c) => c[1])).toEqual([110, 100]);
    // mpv's reports of the first seek's landing arrive after the second was sent: they don't move the playhead.
    await property("seeking", true);
    await property("time-pos", 110);
    await property("seeking", false);
    expect(m.currentTime).toBe(100);
    // Another skip back starts from 100, not from 110.
    m.currentTime = m.currentTime - 10;
    expect(commands.at(-1)).toEqual(["seek", 90, "absolute+exact"]);
  });

  test("the position follows mpv again once the seek has landed", async () => {
    const m = await media();
    m.currentTime = 150;
    await property("time-pos", 100); // the old position, reported before mpv took the seek
    expect(m.currentTime).toBe(150);
    await property("time-pos", 150.04);
    await property("time-pos", 151);
    expect(m.currentTime).toBe(151);
  });
});
