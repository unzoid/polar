import { expect, test } from "bun:test";
import { osLabels } from "../scripts/issueOsLabels";

function form(where: string, ticked: boolean) {
  const box = `- [${ticked ? "X" : " "}] It only happens on the systems I picked.`;
  return `### What happened\n\nIt broke.\n\n### Where you saw it\n\n${where}\n\n### Only on these systems?\n\n${box}\n\n### Polarity version\n\n0.17.0\n`;
}

test("a ticked box labels each system picked", () => {
  expect(osLabels(form("Windows, Android TV / Google TV / Fire TV", true))).toEqual(["windows", "android-tv"]);
});

test("an unticked box labels nothing, whatever was picked", () => {
  expect(osLabels(form("Windows, macOS", false))).toEqual([]);
});

test("only the known systems become labels, never other text", () => {
  expect(osLabels(form("Linux, wontfix, Something else", true))).toEqual(["linux"]);
});

test("a body without the form's fields labels nothing", () => {
  expect(osLabels("Just some text.\n- [X] It only happens on the systems I picked.")).toEqual([]);
});

test("Windows line endings in the body", () => {
  expect(osLabels(form("macOS", true).replace(/\n/g, "\r\n"))).toEqual(["macos"]);
});
