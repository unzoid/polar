import { getPrefs, setPrefs, usePrefs } from "../prefs";

/** What the Anime page can show, top to bottom, in desktop and TV mode. Each can be turned off in Settings → Anime. */
export const ANIME_SHELVES = [
  { id: "hero", label: "Featured" },
  { id: "today", label: "Airing Today" },
  { id: "season", label: "This Season" },
  { id: "trending", label: "Trending Now" },
  { id: "upcoming", label: "Next Season" },
  { id: "top", label: "Highest Rated" },
  { id: "popular", label: "Most Popular" },
  { id: "movies", label: "Movies" },
  { id: "genres", label: "Genres" },
] as const;

export type AnimeShelfId = (typeof ANIME_SHELVES)[number]["id"];

const hiddenIn = (value: string) => new Set(value.split(",").filter(Boolean));

/** Whether a shelf is on. */
export function useShelfVisible() {
  const hidden = hiddenIn(usePrefs().animeHiddenShelves);
  return (id: AnimeShelfId) => !hidden.has(id);
}

export function setShelfVisible(id: AnimeShelfId, visible: boolean) {
  const hidden = hiddenIn(getPrefs().animeHiddenShelves);
  if (visible) hidden.delete(id);
  else hidden.add(id);
  setPrefs({ animeHiddenShelves: [...hidden].join(",") });
}
