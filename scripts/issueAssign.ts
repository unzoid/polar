// Decides what an issue comment's "/assign" or "/unassign" asks for, for
// .github/workflows/issue-assign.yml.
//
// A personal repository can't give anyone the Triage role, so people outside it can't assign
// themselves. GitHub does let anyone who has commented on an issue be assigned to it, so a comment
// command is enough: the workflow assigns the commenter. The command is the comment's first line,
// on its own. Someone else's issue stays theirs: "/assign" on an issue assigned to another person
// gets a reply instead. MAX_OPEN caps how many open issues one person can hold through it.
//
//   bun scripts/issueAssign.ts   (reads $GITHUB_EVENT_PATH and $OPEN_ASSIGNED; prints JSON)

export const MAX_OPEN = 3;

export interface Situation {
  /** The comment's text. */
  body: string;
  /** Who wrote it. */
  user: string;
  /** Whether that account is a bot. */
  bot: boolean;
  /** The issue's assignees now. */
  assignees: string[];
  /** "open" or "closed". */
  state: string;
  /** How many other open issues the commenter is assigned to. */
  openAssigned: number;
}

export type Decision =
  | { action: "none" }
  | { action: "assign" | "unassign"; reply?: string }
  | { action: "reply"; reply: string };

export function command(body: string): "assign" | "unassign" | null {
  const first = body.replace(/\r\n/g, "\n").split("\n")[0].trim().toLowerCase();
  if (first === "/assign") return "assign";
  if (first === "/unassign") return "unassign";
  return null;
}

export function decide(s: Situation): Decision {
  const cmd = command(s.body);
  if (!cmd || s.bot) return { action: "none" };
  const mine = s.assignees.some((a) => a.toLowerCase() === s.user.toLowerCase());
  if (cmd === "unassign") {
    return mine ? { action: "unassign" } : { action: "reply", reply: `@${s.user} you aren't assigned to this issue.` };
  }
  if (s.state !== "open") return { action: "reply", reply: `@${s.user} this issue is closed, so it can't be taken.` };
  if (mine) return { action: "none" };
  const others = s.assignees.filter((a) => a.toLowerCase() !== s.user.toLowerCase());
  if (others.length) {
    return {
      action: "reply",
      reply: `@${s.user} this issue is already assigned to ${others.map((a) => `@${a}`).join(", ")}. Ask them here whether you can help or take it over.`,
    };
  }
  if (s.openAssigned >= MAX_OPEN) {
    return {
      action: "reply",
      reply: `@${s.user} you're already assigned to ${s.openAssigned} open issues, the most "/assign" gives one person. Finish or "/unassign" one first.`,
    };
  }
  return { action: "assign", reply: `@${s.user} this issue is yours now. Comment "/unassign" if you stop working on it.` };
}

if (import.meta.main) {
  const event = JSON.parse(await Bun.file(process.env.GITHUB_EVENT_PATH ?? "").text());
  const decision = decide({
    body: String(event.comment?.body ?? ""),
    user: String(event.comment?.user?.login ?? ""),
    bot: event.comment?.user?.type === "Bot",
    assignees: (event.issue?.assignees ?? []).map((a: { login: string }) => a.login),
    state: String(event.issue?.state ?? ""),
    openAssigned: Number(process.env.OPEN_ASSIGNED ?? 0) || 0,
  });
  console.log(JSON.stringify(decision));
}
