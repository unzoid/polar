import { expect, test } from "bun:test";
import { searchMinLength } from "../src/lib/catalog/searchQuery";

test("one CJK character is a search; one Latin letter isn't yet (skills pass, worst case)", () => {
  expect(searchMinLength("q")).toBe(2);
  expect(searchMinLength("qu")).toBe(2);
  expect(searchMinLength("夜")).toBe(1);
  expect(searchMinLength("あ")).toBe(1);
  expect(searchMinLength("한")).toBe(1);
  expect(searchMinLength("ح")).toBe(2);
});
