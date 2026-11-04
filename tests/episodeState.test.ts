import { expect, test } from "bun:test";
import { episodeState } from "../src/lib/episodeState";
import { shortRuntime } from "../src/lib/format";
import type { Progress, Video } from "../src/lib/types";

const ep = (released?: string) => ({ id: "tt1:1:1", title: "Pilot", season: 1, episode: 1, released }) as Video;
const at = (position: number, duration: number) => ({ position, duration }) as Progress;

test("never played: released, nothing started", () => {
  expect(episodeState(ep("2020-01-01"), undefined, 0.92)).toEqual({ released: true, fraction: 0, watched: false, inProgress: false });
});

test("under way until the threshold, watched from it", () => {
  expect(episodeState(ep(), at(600, 2400), 0.92)).toMatchObject({ fraction: 0.25, watched: false, inProgress: true });
  expect(episodeState(ep(), at(2208, 2400), 0.92)).toMatchObject({ watched: true, inProgress: false });
  // No duration yet: counts as not started.
  expect(episodeState(ep(), at(600, 0), 0.92)).toMatchObject({ fraction: 0, inProgress: false });
});

test("an episode dated in the future isn't released", () => {
  expect(episodeState(ep("2999-01-01"), undefined, 0.92).released).toBe(false);
});

test("short runtime", () => {
  expect(shortRuntime("49 min")).toBe("49m");
  expect(shortRuntime("1h 2min")).toBe("1h 2m");
  expect(shortRuntime(undefined)).toBeUndefined();
});
