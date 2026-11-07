import { expect, test } from "bun:test";
import "./storageStub";
import { monthWeeks, weekDays, weekStart } from "../src/lib/catalog/calendar";

// TV mode's Calendar pages a week at a time; its days are local midnights so episodes (keyed by their
// air day's local midnight) land in the right column.

const at = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

test("a week starts on the locale's first day, at midnight", () => {
  // Friday 13 November 2026, mid-afternoon.
  const fri = at(2026, 11, 13, 15);
  expect(weekStart(fri, 0, 1)).toBe(at(2026, 11, 9)); // Monday
  expect(weekStart(fri, 0, 0)).toBe(at(2026, 11, 8)); // Sunday
  // The first day itself is its own week's start.
  expect(weekStart(at(2026, 11, 9, 9), 0, 1)).toBe(at(2026, 11, 9));
  expect(weekStart(at(2026, 11, 8, 9), 0, 1)).toBe(at(2026, 11, 2));
});

test("weeks before and after, across a month's end", () => {
  const fri = at(2026, 11, 13, 15);
  expect(weekStart(fri, -1, 1)).toBe(at(2026, 11, 2));
  expect(weekStart(fri, 3, 1)).toBe(at(2026, 11, 30));
});

test("a week is seven local midnights, also across a clock change", () => {
  const days = weekDays(at(2026, 3, 23));
  expect(days).toHaveLength(7);
  expect(days.map((d) => new Date(d).getDate())).toEqual([23, 24, 25, 26, 27, 28, 29]);
  expect(days.every((d) => new Date(d).getHours() === 0)).toBe(true);
});

test("Choose Week's month grid: every week a month's days fall in, and no others", () => {
  // November 2026 starts on a Sunday: Monday-first, that's 6 rows from 26 October; Sunday-first, 5 from 1 November.
  const mon = monthWeeks(2026, 10, 1);
  expect(mon).toHaveLength(6);
  expect(mon[0]).toBe(at(2026, 10, 26));
  expect(mon[5]).toBe(at(2026, 11, 30));
  const sun = monthWeeks(2026, 10, 0);
  expect(sun).toHaveLength(5);
  expect(sun[0]).toBe(at(2026, 11, 1));
  // February 2027 is exactly four Monday-first weeks.
  expect(monthWeeks(2027, 1, 1)).toHaveLength(4);
});
