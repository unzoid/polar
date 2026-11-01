/**
 * Profile avatars, drawn in code (see components/Avatar.tsx) so they're crisp
 * at any size and need no hosting. Stored by id; unknown ids fall back to the
 * first one, so removing an avatar never breaks a profile.
 */
export type Face = "smile" | "grin" | "wink" | "calm" | "wow" | "cool";
export type Character =
  | "cat"
  | "bear"
  | "robot"
  | "alien"
  | "ghost"
  | "monster"
  | "fox"
  | "frog"
  | "panda"
  | "owl";
export type AvatarArt = Face | Character;
export type AvatarGroup = "classics" | "characters";

export interface AvatarDef {
  id: string;
  /** Background gradient, top to bottom. */
  from: string;
  to: string;
  art: AvatarArt;
  group: AvatarGroup;
}

export const AVATARS = [
  { id: "blue", from: "#0b6fe6", to: "#5aa3ff", art: "smile", group: "classics" },
  { id: "amber", from: "#e5a50a", to: "#ffd25e", art: "smile", group: "classics" },
  { id: "green", from: "#17a35f", to: "#62d79c", art: "smile", group: "classics" },
  { id: "red", from: "#d62a40", to: "#ff7a7a", art: "smile", group: "classics" },
  { id: "violet", from: "#6c3ce6", to: "#b18cff", art: "grin", group: "classics" },
  { id: "teal", from: "#0b8f9c", to: "#4fd8d3", art: "cool", group: "classics" },
  { id: "pink", from: "#d93283", to: "#ff8cc4", art: "wink", group: "classics" },
  { id: "slate", from: "#3f4855", to: "#8b95a5", art: "calm", group: "classics" },
  { id: "orange", from: "#e8561c", to: "#ff9c5b", art: "wow", group: "classics" },
  { id: "lime", from: "#5e9a12", to: "#b4e04f", art: "grin", group: "classics" },

  { id: "cat", from: "#f2a516", to: "#ffd77a", art: "cat", group: "characters" },
  { id: "bear", from: "#2f9e6a", to: "#7fd6a6", art: "bear", group: "characters" },
  { id: "robot", from: "#5b3fd1", to: "#9f86ff", art: "robot", group: "characters" },
  { id: "alien", from: "#16213e", to: "#2c4a7c", art: "alien", group: "characters" },
  { id: "ghost", from: "#3a2a5c", to: "#7a5cb8", art: "ghost", group: "characters" },
  { id: "monster", from: "#e2468f", to: "#ff9ec8", art: "monster", group: "characters" },
  { id: "fox", from: "#0f7f8c", to: "#4cc7c2", art: "fox", group: "characters" },
  { id: "frog", from: "#f0617a", to: "#ffb0a8", art: "frog", group: "characters" },
  { id: "panda", from: "#6ba81c", to: "#c2e86a", art: "panda", group: "characters" },
  { id: "owl", from: "#24456b", to: "#5684b8", art: "owl", group: "characters" },
] as const satisfies readonly AvatarDef[];

export type AvatarId = (typeof AVATARS)[number]["id"];

export const AVATAR_GROUPS: { id: AvatarGroup; name: string }[] = [
  { id: "classics", name: "Classics" },
  { id: "characters", name: "Characters" },
];

export function avatarDef(id: string): AvatarDef {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0];
}

export function normalizeAvatar(id: string): AvatarId {
  return avatarDef(id).id as AvatarId;
}

/** A classic the account doesn't use yet, for a new profile. */
export function nextAvatar(taken: string[]): AvatarId {
  return (AVATARS.find((a) => !taken.includes(a.id)) ?? AVATARS[taken.length % AVATARS.length]).id;
}
