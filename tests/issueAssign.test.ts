import { expect, test } from "bun:test";
import { MAX_OPEN, command, decide, type Situation } from "../scripts/issueAssign";

const base: Situation = { body: "/assign", user: "helper", bot: false, assignees: [], state: "open", openAssigned: 0 };

test("the command is the comment's first line on its own", () => {
  expect(command("/assign")).toBe("assign");
  expect(command("  /Assign  \r\nI'd like to try this")).toBe("assign");
  expect(command("/unassign")).toBe("unassign");
  expect(command("I'll /assign myself")).toBeNull();
  expect(command("/assign @someone-else")).toBeNull();
});

test("/assign on a free open issue assigns the commenter", () => {
  expect(decide(base)).toMatchObject({ action: "assign" });
});

test("someone else's issue stays theirs", () => {
  const d = decide({ ...base, assignees: ["lusetto"] });
  expect(d.action).toBe("reply");
  expect(d.action === "reply" && d.reply).toContain("@lusetto");
});

test("a closed issue can't be taken", () => {
  expect(decide({ ...base, state: "closed" }).action).toBe("reply");
});

test("the cap on open issues per person", () => {
  expect(decide({ ...base, openAssigned: MAX_OPEN - 1 }).action).toBe("assign");
  expect(decide({ ...base, openAssigned: MAX_OPEN }).action).toBe("reply");
});

test("assigning yourself twice does nothing", () => {
  expect(decide({ ...base, assignees: ["Helper"] })).toEqual({ action: "none" });
});

test("/unassign removes only yourself", () => {
  expect(decide({ ...base, body: "/unassign", assignees: ["helper", "lusetto"] })).toEqual({ action: "unassign" });
  expect(decide({ ...base, body: "/unassign", assignees: ["lusetto"] }).action).toBe("reply");
});

test("bots and ordinary comments are ignored", () => {
  expect(decide({ ...base, bot: true })).toEqual({ action: "none" });
  expect(decide({ ...base, body: "Looks good to me" })).toEqual({ action: "none" });
});
