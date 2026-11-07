/**
 * Preferred release groups (Settings → Anime): sources from groups you trust
 * score higher in Best Match (lib/playback/bestMatch.ts), the first most. A
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
