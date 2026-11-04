/**
 * Preferred release groups (Settings → Anime): sources from groups you trust
 * go to the top of anime source lists and are what autoplay picks first. A
 * source's group is what crates/addon's `release_source` reads from its name
 * ("[Group] Show - 01").
 */

/** "Group A, Group B" → the groups, most preferred first. */
export function preferredGroups(setting: string): string[] {
  return setting
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}

/** Group names as release names spell them: "Some-Group", "some group" and "SOME-GROUP" are one group. */
const groupKey = (g: string) => g.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * How much to add to a source's score for its group. A source's own score
 * stays within a few hundred (resolution, instant start, sources), so 1000
 * per place puts the first group above the second and both above everything
 * else, while each group's own sources keep their usual order.
 */
export function groupBoost(source: string | null | undefined, groups: string[]): number {
  if (!source) return 0;
  const i = groups.findIndex((g) => groupKey(g) === groupKey(source));
  return i < 0 ? 0 : (groups.length - i) * 1000;
}
