import type { InstalledAddon, LibraryItem, Meta, MetaPreview, Progress, Settings, StreamsResult, Video } from "../../types";

/**
 * Made-up titles for the fake shell (fake.html): enough of every kind of data
 * for each screen to fill up. Pictures are drawn here as SVG, so the page
 * needs no network.
 */

const HUES = [210, 12, 145, 280, 38, 330, 190, 95, 255, 0, 170, 60];

function art(label: string, i: number, w: number, h: number): string {
  const hue = HUES[i % HUES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue} 55% 42%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 60% 14%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<circle cx="${w * 0.72}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.22}" fill="hsl(${hue} 70% 70% / 0.25)"/>
<text x="${w / 2}" y="${h * 0.82}" font-family="sans-serif" font-size="${Math.round(w / 11)}" font-weight="700" fill="white" text-anchor="middle">${label}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const MOVIE_NAMES = [
  "The Glass Orchard",
  "Northbound",
  "Paper Lanterns",
  "Static Bloom",
  "The Long Quiet",
  "Harbor Lights",
  "Ninefold",
  "Copper Sky",
  "Undertow",
  "A Map of Rain",
  "The Salt Road",
  "Lowlands",
  "Signal Fire",
  "Amber Hours",
  "The Cartographer",
  "Driftwood",
  "Outer Reach",
  "Second Summer",
  "The Hollow Crown Inn",
  "Night Ferry",
  "Wildflower",
  "Iron Valley",
  "The Last Tram",
  "Meridian",
];
const SERIES_NAMES = [
  "Station Eleven Below",
  "The Understudies",
  "Fieldwork",
  "Blue Hour",
  "Kingsbridge",
  "The Archive",
  "Small Hours",
  "Westerly",
  "Parallel Lines",
  "Greenhouse",
  "The Foundry",
  "Lantern Street",
  "Overland",
  "Tidewater",
  "Quiet Machines",
  "The Night Desk",
  "Highwire",
  "Orchard House",
];
const GENRES = ["Drama", "Comedy", "Sci-Fi", "Thriller", "Mystery", "Adventure", "Romance", "Animation", "Crime"];
const BLURB =
  "When an old letter turns up in the wrong mailbox, three strangers set out across a flooded county to deliver it, " +
  "and find that the address it names no longer exists on any map.";

function preview(type: "movie" | "series", name: string, i: number): MetaPreview {
  return {
    id: `tt${(type === "movie" ? 9100000 : 9200000) + i}`,
    type,
    name,
    poster: art(name, i, 342, 513),
    background: art("", i + 3, 1280, 720),
    description: BLURB,
    releaseInfo: type === "movie" ? String(2024 - (i % 30)) : `${2019 + (i % 6)}–`,
    imdbRating: (6 + ((i * 7) % 35) / 10).toFixed(1),
    genres: [GENRES[i % GENRES.length], GENRES[(i + 3) % GENRES.length]],
  };
}

export const movies = MOVIE_NAMES.map((n, i) => preview("movie", n, i));
export const series = SERIES_NAMES.map((n, i) => preview("series", n, i));
export const all = [...movies, ...series];

/** A catalog page: the list rotated by the catalog's name so shelves differ. */
export function catalogPage(type: string, id: string, skip: number): MetaPreview[] {
  const list = type === "series" ? series : movies;
  const shift = [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % list.length;
  const rotated = [...list.slice(shift), ...list.slice(0, shift)];
  // Two pages, then the end.
  return skip >= list.length * 2 ? [] : rotated.map((m) => ({ ...m }));
}

function episodes(p: MetaPreview, i: number): Video[] {
  const out: Video[] = [];
  for (let season = 1; season <= 3; season++)
    for (let episode = 1; episode <= (season === 3 ? 6 : 10); episode++)
      out.push({
        id: `${p.id}:${season}:${episode}`,
        title: `Chapter ${episode}: ${["Arrivals", "The Ledger", "Low Tide", "Crossings", "Embers", "Return"][episode % 6]}`,
        season,
        episode,
        released: `202${season}-0${1 + (episode % 9)}-1${episode % 9}T00:00:00.000Z`,
        thumbnail: art(`${season}×${episode}`, i + season + episode, 400, 225),
        overview: BLURB,
        rating: (7 + (episode % 20) / 10).toFixed(1),
      });
  return out;
}

export function meta(id: string): Meta | null {
  const i = all.findIndex((m) => m.id === id);
  if (i < 0) return null;
  const p = all[i];
  return {
    ...p,
    logo: undefined,
    runtime: p.type === "movie" ? "118 min" : "52 min",
    cast: ["Ada Brennan", "Tomas Okafor", "Mei Lindqvist", "Rafael Duarte", "June Halloway"],
    director: ["Ines Marchetti"],
    people: ["Ada Brennan", "Tomas Okafor", "Mei Lindqvist", "Rafael Duarte", "June Halloway", "Oskar Veldt"].map((name, k) => ({
      name,
      character: ["Nora", "Elias", "Captain Rhee", "Mateo", "Clara", "The Ferryman"][k],
      photo: art(
        name
          .split(" ")
          .map((w) => w[0])
          .join(""),
        k + i,
        185,
        278,
      ),
    })),
    videos: p.type === "series" ? episodes(p, i) : [],
    details: {
      tagline: "Every road ends somewhere.",
      status: p.type === "series" ? "Returning Series" : "Released",
      released: "2023-09-14",
      countries: ["Ireland", "Norway"],
      languages: ["English"],
      studios: ["Fernhill Pictures"],
      writers: ["Ines Marchetti", "Paul Achebe"],
      seasons: p.type === "series" ? 3 : undefined,
      episodes: p.type === "series" ? 26 : undefined,
      votes: 18234,
    },
  };
}

const now = Date.now();
export const library: LibraryItem[] = [...series.slice(0, 5), ...movies.slice(2, 9)].map((m, k) => ({
  id: m.id,
  type: m.type,
  name: m.name,
  poster: m.poster,
  addedAt: now - k * 86_400_000,
}));

export const progress: Progress[] = [series[1], movies[4], series[3], movies[0]].map((m, k) => ({
  metaId: m.id,
  videoId: m.type === "series" ? `${m.id}:2:${k + 3}` : m.id,
  type: m.type,
  name: m.name,
  poster: m.poster,
  background: m.background,
  season: m.type === "series" ? 2 : undefined,
  episode: m.type === "series" ? k + 3 : undefined,
  episodeTitle: m.type === "series" ? "Chapter 3: Crossings" : undefined,
  position: 1200 + k * 600,
  duration: 3100,
  updatedAt: now - k * 3_600_000,
}));

export const addons: InstalledAddon[] = [
  {
    manifestUrl: "https://addons.example/films/manifest.json",
    manifest: {
      id: "example.films",
      version: "1.2.0",
      name: "Open Films",
      description: "Public-domain and openly licensed films.",
      types: ["movie", "series"],
      resources: ["stream", "meta"],
      behaviorHints: { configurable: false, configurationRequired: false },
    },
  },
  {
    manifestUrl: "https://addons.example/subs/manifest.json",
    manifest: {
      id: "example.subs",
      version: "0.4.1",
      name: "Community Subtitles",
      types: ["movie", "series"],
      resources: ["subtitles"],
      behaviorHints: { configurable: true, configurationRequired: false },
    },
  },
];

export function streams(): StreamsResult {
  const rows: [number, boolean, number, string][] = [
    [2160, true, 14.2e9, "WEB-DL HDR10"],
    [1080, false, 4.1e9, "WEB-DL"],
    [720, false, 1.6e9, "WEB"],
  ];
  return {
    streams: rows.map(([resolution, hdr, sizeBytes, title], k) => ({
      addon: "Open Films",
      stream: { url: `https://media.example/${k}.mp4`, name: `Open Films\n${resolution}p`, title },
      quality: { resolution, hdr, dolbyVision: false, sizeBytes, lowQualitySource: false, direct: true, languages: ["en"], tags: hdr ? ["HDR10"] : [] },
      score: 100 - k * 10,
      label: `${resolution}p`,
    })),
    failed: [],
  };
}

export const settings: Settings = {
  tmdbKey: null,
  language: "en-US",
  autoplayNext: true,
  seekrKey: null,
  seekPreviews: true,
  autoSkip: false,
  audioLanguage: "",
  subtitleLanguage: "",
  seekStep: 10,
  autoPickSource: true,
  showCardTitles: true,
  showCardDetails: true,
  showCardRatings: false,
  ratingColors: false,
  episodeLayout: "row",
  uiFont: "inter",
  subtitleStyle: { size: 100, raise: 0, color: "#FFFFFF", opacity: 100, outline: "thin", outlineColor: "#000000", background: 0, font: "Segoe UI Semibold" },
  autoplayCountdown: 8,
  stillWatchingAfter: 0,
  nextUpTiming: "credits",
  autoSkipRecaps: null,
  resumePlayback: true,
  resumeRewind: 0,
  watchedThreshold: 92,
  startFullscreen: false,
  timeDisplay: "remaining",
  controlsHideSecs: 2,
  wheelAction: "volume",
  clickAction: "toggle",
  rememberSpeed: false,
  playbackSpeed: 1,
  maxResolution: 0,
  maxMovieSizeGb: 0,
  maxEpisodeSizeGb: 0,
  hideCam: true,
  excludeKeywords: "",
  sourceSort: "best",
  sourceAutoTags: [],
  preferScreenResolution: true,
  sourceFiltersHide: false,
  mdblistKey: null,
  omdbKey: null,
  subtitleMode: "always",
  accentColor: "#0A84FF",
  theme: "dark",
  cardSize: "medium",
  reduceMotion: "system",
  heroAutoplay: true,
  showContinueWatching: true,
  hideEpisodeThumbs: false,
  hideEpisodeDescriptions: false,
  startPage: "home",
  trailerAutoplay: true,
  trailerSound: false,
  cardRatingPosition: "poster",
  showCalendar: false,
} as Settings;
