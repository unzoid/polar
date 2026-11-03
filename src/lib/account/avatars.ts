/**
 * Profile avatars, rendered by DiceBear (see components/Avatar.tsx) so they're
 * crisp at any size and need no hosting. Each one is a style plus a seed and a
 * background; stored by id. Unknown ids fall back to the first avatar, so
 * removing one never breaks a profile.
 */
export type AvatarStyle = "glass" | "notionists" | "thumbs";
export type AvatarGroup = "abstract" | "people" | "friends";

export interface AvatarDef {
  id: string;
  style: AvatarStyle;
  /** Picks the artwork within the style. */
  seed: string;
  /** Background gradient, top to bottom. */
  from: string;
  to: string;
  /** Hex (no #) for the figure itself, where the style draws one in a single colour. */
  ink?: string;
  group: AvatarGroup;
}

export const AVATARS = [
  { id: "aurora", style: "glass", seed: "aurora", from: "#1d4ed8", to: "#22d3ee", group: "abstract" },
  { id: "ember", style: "glass", seed: "ember", from: "#c2410c", to: "#facc15", group: "abstract" },
  { id: "lagoon", style: "glass", seed: "lagoon", from: "#0f766e", to: "#5eead4", group: "abstract" },
  { id: "dusk", style: "glass", seed: "dusk", from: "#6d28d9", to: "#f472b6", group: "abstract" },
  { id: "moss", style: "glass", seed: "moss", from: "#3f6212", to: "#a3e635", group: "abstract" },
  { id: "tide", style: "glass", seed: "tide", from: "#1e3a8a", to: "#818cf8", group: "abstract" },
  { id: "coral", style: "glass", seed: "coral", from: "#be123c", to: "#fb923c", group: "abstract" },
  { id: "graphite", style: "glass", seed: "graphite", from: "#27272a", to: "#a1a1aa", group: "abstract" },

  { id: "ada", style: "notionists", seed: "ada", from: "#fde68a", to: "#fcd34d", group: "people" },
  { id: "milo", style: "notionists", seed: "milo", from: "#bae6fd", to: "#7dd3fc", group: "people" },
  { id: "noor", style: "notionists", seed: "noor", from: "#fbcfe8", to: "#f9a8d4", group: "people" },
  { id: "kai", style: "notionists", seed: "kai", from: "#bbf7d0", to: "#86efac", group: "people" },
  { id: "iris", style: "notionists", seed: "iris", from: "#ddd6fe", to: "#c4b5fd", group: "people" },
  { id: "otto", style: "notionists", seed: "otto", from: "#fed7aa", to: "#fdba74", group: "people" },
  { id: "luz", style: "notionists", seed: "luz", from: "#a5f3fc", to: "#67e8f9", group: "people" },
  { id: "rex", style: "notionists", seed: "rex", from: "#e5e7eb", to: "#d1d5db", group: "people" },

  { id: "pip", style: "thumbs", seed: "pip", from: "#f43f5e", to: "#fb7185", ink: "9f1239", group: "friends" },
  { id: "bo", style: "thumbs", seed: "bo", from: "#0ea5e9", to: "#38bdf8", ink: "0c4a6e", group: "friends" },
  { id: "zuzu", style: "thumbs", seed: "zuzu", from: "#10b981", to: "#34d399", ink: "065f46", group: "friends" },
  { id: "momo", style: "thumbs", seed: "momo", from: "#8b5cf6", to: "#a78bfa", ink: "4c1d95", group: "friends" },
  { id: "tok", style: "thumbs", seed: "tok", from: "#f59e0b", to: "#fbbf24", ink: "92400e", group: "friends" },
  { id: "fig", style: "thumbs", seed: "fig", from: "#ec4899", to: "#f472b6", ink: "831843", group: "friends" },
] as const satisfies readonly AvatarDef[];

export type AvatarId = (typeof AVATARS)[number]["id"];

export const AVATAR_GROUPS: { id: AvatarGroup; name: string }[] = [
  { id: "abstract", name: "Abstract" },
  { id: "people", name: "People" },
  { id: "friends", name: "Friends" },
];

/** Ids from the earlier hand-drawn set, so existing profiles keep a distinct look. */
const LEGACY: Record<string, AvatarId> = {
  blue: "aurora",
  amber: "ember",
  green: "lagoon",
  red: "coral",
  violet: "dusk",
  teal: "tide",
  pink: "noor",
  slate: "graphite",
  orange: "otto",
  lime: "moss",
  cat: "pip",
  bear: "bo",
  robot: "rex",
  alien: "momo",
  ghost: "iris",
  monster: "fig",
  fox: "kai",
  frog: "zuzu",
  panda: "milo",
  owl: "ada",
};

export function avatarDef(id: string): AvatarDef {
  const resolved = LEGACY[id] ?? id;
  return AVATARS.find((a) => a.id === resolved) ?? AVATARS[0];
}

export function normalizeAvatar(id: string): AvatarId {
  return avatarDef(id).id as AvatarId;
}

/** An avatar the account doesn't use yet, for a new profile. */
export function nextAvatar(taken: string[]): AvatarId {
  return (AVATARS.find((a) => !taken.includes(a.id)) ?? AVATARS[taken.length % AVATARS.length]).id;
}
