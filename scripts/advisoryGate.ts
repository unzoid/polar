// Reads OSV-Scanner's JSON report and decides whether the security workflow fails: only advisories
// rated high or critical do (CVSS 7.0 or more, or GitHub's "HIGH"/"CRITICAL" when no score is given);
// everything else is listed in the job summary and the job passes. Used by
// .github/workflows/security.yml (docs/testing.md, "Dependency checks").
//
//   bun scripts/advisoryGate.ts osv.json >> "$GITHUB_STEP_SUMMARY"

export interface Finding {
  ecosystem: string;
  name: string;
  version: string;
  ids: string[];
  /** The highest CVSS score among the advisory's ratings, when it has one. */
  score: number | null;
  blocking: boolean;
}

interface OsvGroup {
  ids?: string[];
  aliases?: string[];
  max_severity?: string;
}

interface OsvVuln {
  id?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
}

interface OsvPackage {
  package?: { name?: string; version?: string; ecosystem?: string };
  vulnerabilities?: OsvVuln[];
  groups?: OsvGroup[];
}

interface OsvReport {
  results?: { packages?: OsvPackage[] }[];
}

const HIGH = 7.0;

export function findings(report: OsvReport): Finding[] {
  const out: Finding[] = [];
  for (const result of report.results ?? []) {
    for (const pkg of result.packages ?? []) {
      const vulns = pkg.vulnerabilities ?? [];
      for (const group of pkg.groups ?? []) {
        const ids = group.ids ?? [];
        const parsed = Number.parseFloat(group.max_severity ?? "");
        const score = Number.isFinite(parsed) ? parsed : null;
        const rated = vulns
          .filter((v) => ids.includes(v.id ?? "") || (v.aliases ?? []).some((a) => ids.includes(a)))
          .some((v) => ["HIGH", "CRITICAL"].includes((v.database_specific?.severity ?? "").toUpperCase()));
        out.push({
          ecosystem: pkg.package?.ecosystem ?? "?",
          name: pkg.package?.name ?? "?",
          version: pkg.package?.version ?? "?",
          ids,
          score,
          blocking: score !== null ? score >= HIGH : rated,
        });
      }
    }
  }
  return out;
}

export function summary(list: Finding[]): string {
  if (list.length === 0) return "### Dependency advisories\n\nNone.\n";
  const rows = list
    .slice()
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || (b.score ?? 0) - (a.score ?? 0))
    .map((f) => `| ${f.blocking ? "**fails**" : "listed"} | ${f.ecosystem} | ${f.name} ${f.version} | ${f.ids.join(", ")} | ${f.score ?? "–"} |`);
  return ["### Dependency advisories", "", "| | Ecosystem | Package | Advisory | CVSS |", "|---|---|---|---|---|", ...rows, ""].join("\n");
}

if (import.meta.main) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: bun scripts/advisoryGate.ts <osv-scanner.json>");
  const list = findings(JSON.parse(await Bun.file(path).text()) as OsvReport);
  console.log(summary(list));
  const blocking = list.filter((f) => f.blocking);
  for (const f of blocking) console.error(`::error::${f.ecosystem} ${f.name} ${f.version}: ${f.ids.join(", ")} (high or critical)`);
  process.exit(blocking.length > 0 ? 1 : 0);
}
