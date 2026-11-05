import { expect, test } from "bun:test";
import { formatBytes, formatDate, formatRemaining, joinFacts, kindFacts, shortRuntime } from "../src/lib/format";

test("a facts line leaves out what's missing", () => {
  expect(joinFacts(["2021", undefined, "", false, null, 0, "2h 35m"])).toBe("2021 · 2h 35m");
  expect(joinFacts([undefined, ""])).toBe("");
});

test("kind facts: type and the first two genres", () => {
  expect(kindFacts({ type: "movie", genres: ["Drama", "Sci-Fi", "Adventure"] })).toEqual(["Movie", "Drama", "Sci-Fi"]);
  expect(kindFacts({ type: "series" })).toEqual(["Series"]);
});

test("time left rounds before it splits hours, and says nothing without a length (skills pass, worst case)", () => {
  expect(formatRemaining(0, 100 * 3600 - 20)).toBe("100h 0m left"); // was "99h 60m left"
  expect(formatRemaining(0, 3570)).toBe("1h 0m left");
  expect(formatRemaining(600, 3600)).toBe("50m left");
  expect(formatRemaining(3599, 3600)).toBe("1m left");
  expect(formatRemaining(5000, 3600)).toBe("1m left"); // past the end
  expect(formatRemaining(10, 0)).toBe("");
});

test("an episode's short runtime has hours past an hour", () => {
  expect(shortRuntime("49 min")).toBe("49m");
  expect(shortRuntime("1284 min")).toBe("21h 24m");
  expect(shortRuntime("60 min")).toBe("1h 0m");
  expect(shortRuntime("2h")).toBe("2h");
  expect(shortRuntime(undefined)).toBeUndefined();
});

test("sizes reach terabytes, and a few bytes aren't \"0 MB\"", () => {
  expect(formatBytes(850e6)).toBe("850 MB");
  expect(formatBytes(12.4e9)).toBe("12.4 GB");
  expect(formatBytes(999.96e9)).toBe("1.0 TB"); // not "1000.0 GB"
  expect(formatBytes(1.05e12)).toBe("1.1 TB");
  expect(formatBytes(1)).toBe("<1 MB");
});

test("an air date is the calendar date it names, in any timezone", () => {
  expect(formatDate("2087-12-31T00:00:00.000Z")).toContain("2087");
  expect(formatDate("2087-12-31T23:30:00.000Z")).toContain("31");
  expect(formatDate(undefined)).toBe("");
});
