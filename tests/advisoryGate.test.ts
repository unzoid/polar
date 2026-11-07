import { expect, test } from "bun:test";
import { findings, summary } from "../scripts/advisoryGate";

function report(packages: unknown[]) {
  return { results: [{ source: { path: "/src/Cargo.lock", type: "lockfile" }, packages }] };
}

function pkg(name: string, groups: { ids: string[]; max_severity?: string }[], severity?: string) {
  return {
    package: { name, version: "1.0.0", ecosystem: "crates.io" },
    vulnerabilities: groups.flatMap((g) => g.ids.map((id) => ({ id, database_specific: severity ? { severity } : {} }))),
    groups,
  };
}

test("a CVSS score of 7 or more fails, lower is only listed", () => {
  const list = findings(
    report([pkg("high-one", [{ ids: ["RUSTSEC-0000-0001"], max_severity: "7.5" }]), pkg("low-one", [{ ids: ["RUSTSEC-0000-0002"], max_severity: "5.3" }])]),
  );
  expect(list.map((f) => [f.name, f.blocking])).toEqual([
    ["high-one", true],
    ["low-one", false],
  ]);
});

test("without a score, GitHub's HIGH or CRITICAL rating fails", () => {
  const list = findings(
    report([pkg("rated", [{ ids: ["GHSA-xxxx-xxxx-xxxx"], max_severity: "" }], "CRITICAL"), pkg("moderate", [{ ids: ["GHSA-yyyy-yyyy-yyyy"] }], "MODERATE")]),
  );
  expect(list.map((f) => [f.name, f.score, f.blocking])).toEqual([
    ["rated", null, true],
    ["moderate", null, false],
  ]);
});

test("unsound or unmaintained notices with no rating are listed, not failed", () => {
  expect(findings(report([pkg("old-crate", [{ ids: ["RUSTSEC-0000-0003"] }])]))[0].blocking).toBe(false);
});

test("an empty report passes and says so", () => {
  expect(findings({ results: [] })).toEqual([]);
  expect(findings({})).toEqual([]);
  expect(summary([])).toContain("None.");
});

test("the summary puts failing advisories first", () => {
  const list = findings(report([pkg("low-one", [{ ids: ["A"], max_severity: "3.1" }]), pkg("high-one", [{ ids: ["B"], max_severity: "9.8" }])]));
  const lines = summary(list)
    .split("\n")
    .filter((l) => l.startsWith("| **") || l.startsWith("| listed"));
  expect(lines[0]).toContain("high-one");
  expect(lines[1]).toContain("low-one");
});
