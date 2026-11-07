/** The settings pages, in sidebar order. Icons live with the UI (components/settings/pages.ts). */
export type PageId =
  | "account"
  | "playback"
  | "sources"
  | "subtitles"
  | "appearance"
  | "browsing"
  | "anime"
  | "notifications"
  | "controls"
  | "controller"
  | "marketplace"
  | "addons"
  | "services"
  | "advanced"
  | "about";

export const PAGE_LABELS: Record<PageId, string> = {
  account: "Account",
  playback: "Playback",
  sources: "Sources",
  subtitles: "Subtitles & Audio",
  appearance: "Appearance",
  browsing: "Browsing",
  anime: "Anime",
  notifications: "Notifications",
  controls: "Controls & TV",
  controller: "Controller",
  marketplace: "Marketplace",
  addons: "Add-ons",
  services: "Services",
  advanced: "Advanced",
  about: "About & Updates",
};

export const PAGE_IDS = Object.keys(PAGE_LABELS) as PageId[];

export const isPageId = (id: unknown): id is PageId => typeof id === "string" && id in PAGE_LABELS;
