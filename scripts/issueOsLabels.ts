// Prints the OS labels an issue opened from a form asks for, one per line.
//
// The bug, playback, performance and accessibility forms (.github/ISSUE_TEMPLATE) have a "Where
// you saw it" dropdown and an "Only on these systems?" tick box. GitHub renders a submitted form as
// Markdown: each field is a "### <label>" heading followed by its answer, a multi-select as
// "A, B", a ticked box as "- [X] ...". Labels come only from OS_LABELS, so nothing a reporter types
// can create or apply any other label. Used by .github/workflows/issue-labels.yml.
//
//   bun scripts/issueOsLabels.ts < issue-body.md

export const OS_LABELS: Record<string, string> = {
  Windows: "windows",
  macOS: "macos",
  Linux: "linux",
  "Android phone or tablet": "android",
  "Android TV / Google TV / Fire TV": "android-tv",
};

/** Each "### heading" of the rendered form, mapped to the text under it. */
function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of body.split(/^### /m).slice(1)) {
    const end = part.indexOf("\n");
    const heading = (end < 0 ? part : part.slice(0, end)).trim();
    out.set(heading, end < 0 ? "" : part.slice(end + 1).trim());
  }
  return out;
}

export function osLabels(body: string): string[] {
  const s = sections(body.replace(/\r\n/g, "\n"));
  if (!/^- \[[xX]\] /m.test(s.get("Only on these systems?") ?? "")) return [];
  return (s.get("Where you saw it") ?? "")
    .split(", ")
    .map((p) => OS_LABELS[p.trim()])
    .filter((l): l is string => !!l);
}

if (import.meta.main) {
  const body = await new Response(Bun.stdin.stream()).text();
  const labels = osLabels(body);
  if (labels.length) console.log(labels.join("\n"));
}
