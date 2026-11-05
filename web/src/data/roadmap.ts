/**
 * The public roadmap. Edit by hand: move an item between groups by changing
 * its `status`. Items link to their GitHub issue when `issue` is set.
 */
export type Status = "beta" | "progress" | "planned";

export type RoadmapItem = { title: string; body: string; status: Status; issue?: number };

export const GROUPS: { status: Status; title: string; body: string; badge: string }[] = [
  { status: "beta", title: "On Beta", body: "Ready to try in a pre-release build.", badge: "On Beta" },
  { status: "progress", title: "In Progress", body: "Being worked on now.", badge: "In progress" },
  { status: "planned", title: "Planned", body: "Planned for later.", badge: "Planned" },
];

export const ITEMS: RoadmapItem[] = [
  { status: "progress", title: "macOS app", body: "Polarity on the Mac, with the same player and TV mode." },
  { status: "progress", title: "Linux app", body: "AppImage, .deb and .rpm builds for Linux desktops." },
  { status: "planned", title: "Download a whole season", body: "Save a full season, or a whole show, in one go.", issue: 24 },
  { status: "planned", title: "Ready-to-play sources", body: "See which sources will actually play before you pick one.", issue: 21 },
  { status: "planned", title: "Discord Rich Presence", body: "Show friends what you're watching on Discord.", issue: 31 },
  { status: "planned", title: "AirPlay", body: "Send what's playing to an Apple TV or AirPlay receiver.", issue: 19 },
  { status: "planned", title: "Android and Android TV", body: "Polarity on phones, tablets and the TV itself.", issue: 28 },
  { status: "planned", title: "iOS app", body: "Polarity on iPhone and iPad.", issue: 29 },
];
