import type { InstalledAddon, LibraryItem, Meta, MetaPreview, Progress, Settings, StreamsResult, Video } from "../../types";

/**
 * Made-up titles for the fake shell (fake.html): enough of every kind of data
 * for each screen to fill up. Pictures are drawn here as SVG, so the page
 * needs no network.
 */

/**
 * `fake.html?worst=1` (or localStorage `polar.fakeWorst` = "1"): the break-ui worst case,
 * long, short, non-Latin and missing values everywhere. `?worst=empty`: zero of everything
 * that can be zero (library, history, add-ons, sources, search results).
 */
export const WORST = new URLSearchParams(location.search).get("worst") ?? localStorage.getItem("polar.fakeWorst") ?? "";

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
  "Low Water Station",
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
const W_LONG = "The Extraordinarily Long and Winding Chronicle of the Lighthouse Keeper's Seventh Daughter and Her Unfinished Correspondence";
const W_NAMES = [W_LONG, "Q", "夜明けの図書館と七つの鍵", "حكايات البحر الأخير", "🦊 Ember Fox 🌙✨", "Donaudampfschifffahrtsgesellschaftskapitänswitwe", "Ngày Xửa Ngày Xưa Ở Bến Đò", "<b>Bold</b> &amp; Brave", "Untitled", "Jo"];
const W_GENRES = ["Psychological Science-Fiction Thriller", "Historical Romantic Comedy-Drama", "Documentary", "Animation"];
if (WORST) {
  MOVIE_NAMES.splice(0, W_NAMES.length, ...W_NAMES);
  SERIES_NAMES.splice(0, W_NAMES.length, ...W_NAMES.map((n, k) => (k === 0 ? `${n}: The Series` : n)));
}
const GENRES = ["Drama", "Comedy", "Sci-Fi", "Thriller", "Mystery", "Adventure", "Romance", "Animation", "Crime"];
const BLURB =
  "When an old letter turns up in the wrong mailbox, three strangers set out across a flooded county to deliver it, " +
  "and find that the address it names no longer exists on any map.";

function preview(type: "movie" | "series", name: string, i: number): MetaPreview {
  const p = basePreview(type, name, i);
  if (!WORST || i >= W_NAMES.length) return p;
  // Each title misses something different; the first has everything at its longest.
  if (i === 0) return { ...p, description: BLURB.repeat(14), genres: W_GENRES, imdbRating: "10.0", releaseInfo: type === "movie" ? "1895" : "1999–2087" };
  if (i % 2 === 1) p.poster = undefined;
  if (i % 3 === 1) p.background = undefined;
  if (i % 3 === 2) p.releaseInfo = undefined;
  if (i % 4 === 1) p.imdbRating = undefined;
  if (i === 3) p.imdbRating = "1.0";
  if (i % 4 === 2) p.description = undefined;
  if (i === 5) p.genres = [];
  return p;
}

function basePreview(type: "movie" | "series", name: string, i: number): MetaPreview {
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

/**
 * `fake.html?films=1`: the README's screenshots (scripts/readme-shots.ts). The Blender Foundation's
 * open films lead the movies and Continue Watching, pictured with frames of the films that the
 * script serves under /readme-shots/ (docs/screenshots.md says how they're licensed and credited).
 */
export const FILMS = new URLSearchParams(location.search).get("films") === "1";
const OPEN_FILMS: [key: string, name: string, year: string, genres: string[], description: string][] = [
  ["sintel", "Sintel", "2010", ["Animation", "Fantasy"], "A young woman crosses snow, desert and city alone, searching for the baby dragon she once nursed back to health."],
  ["tears-of-steel", "Tears of Steel", "2012", ["Sci-Fi", "Action"], "In a future Amsterdam, a band of scientists and soldiers stage one last scene to stop an army of robots."],
  ["big-buck-bunny", "Big Buck Bunny", "2008", ["Animation", "Comedy"], "A large, gentle rabbit has had enough of the three rodents who torment the smaller animals of his meadow."],
];
const openFilms: MetaPreview[] = FILMS
  ? OPEN_FILMS.map(([key, name, year, genres, description], i) => ({
      id: `tt${9000001 + i}`,
      type: "movie",
      name,
      poster: `/readme-shots/${key}-poster.jpg`,
      background: `/readme-shots/${key}-backdrop.jpg`,
      description,
      releaseInfo: year,
      genres,
    }))
  : [];

export const movies = [...openFilms, ...MOVIE_NAMES.map((n, i) => preview("movie", n, i))];
export const series = SERIES_NAMES.map((n, i) => preview("series", n, i));
export const all = [...movies, ...series];

/** A catalog page: the list rotated by the catalog's name so shelves differ. */
export function catalogPage(type: string, id: string, skip: number): MetaPreview[] {
  const list = type === "series" ? series : movies;
  // The open films stay first (FILMS); the rest turn.
  const fixed = type === "series" ? 0 : openFilms.length;
  const rest = list.slice(fixed);
  const shift = [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % rest.length;
  const rotated = [...list.slice(0, fixed), ...rest.slice(shift), ...rest.slice(0, shift)];
  // Two pages, then the end.
  return skip >= list.length * 2 ? [] : rotated.map((m) => ({ ...m }));
}

function worstEpisodes(p: MetaPreview, i: number): Video[] {
  if (i % W_NAMES.length === 1) return []; // "Q": a series with no episodes at all
  const out: Video[] = [];
  // 40 seasons of 3, then a season numbered 2024 whose 400 episodes run up to 9999.
  const seasons: [number, number[]][] = Array.from({ length: 40 }, (_, s) => [s + 1, [1, 2, 3]]);
  seasons.push([2024, Array.from({ length: 400 }, (_, k) => 9600 + k)]);
  for (const [season, eps] of seasons)
    for (const episode of eps)
      out.push({
        id: `${p.id}:${season}:${episode}`,
        title: episode % 3 === 0 ? `${W_LONG}, Part ${episode}` : episode % 3 === 1 ? "E" : "",
        season,
        episode,
        released: episode % 2 ? undefined : "2087-12-31T23:30:00.000Z",
        thumbnail: episode % 2 ? undefined : art(`${season}×${episode}`, i + episode, 400, 225),
        overview: episode % 3 === 0 ? BLURB.repeat(6) : undefined,
        rating: episode % 3 === 0 ? "10.0" : undefined,
        tag: episode % 5 === 0 ? "Mixed Canon / Partial Filler" : undefined,
      });
  return out;
}

function episodes(p: MetaPreview, i: number): Video[] {
  if (WORST) return worstEpisodes(p, i);
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
  const m = baseMeta(id);
  if (!m || !WORST) return m;
  const long = m.name.length > 60;
  return {
    ...m,
    runtime: long ? "1284 min" : m.name === "Q" ? undefined : "1 min",
    people: long
      ? m.people?.map((p, k) => ({
          name: k % 2 ? "Aleksandra Wiśniewska-Kowalczyk von Hohenberg-Eisenach" : "王秀英",
          character: k % 2 ? "The Lighthouse Keeper's Seventh Daughter (voice, uncredited, archive footage)" : undefined,
          photo: k % 3 ? undefined : p.photo,
        }))
      : [],
    cast: long ? m.cast : [],
    director: long ? ["Christopher Alexander Montgomery III", "Jo", "نور الهدى عبد الرحمن"] : [],
    details: long
      ? {
          ...m.details,
          tagline: BLURB,
          status: "In Production (Post-Production Delayed Indefinitely)",
          countries: ["United Kingdom of Great Britain and Northern Ireland", "Bosnia and Herzegovina", "Papua New Guinea", "Côte d'Ivoire", "Ireland", "Norway"],
          languages: ["English", "日本語", "العربية", "Tiếng Việt", "Deutsch", "Kalaallisut"],
          studios: ["Fernhill Pictures International Co-Production Consortium Limited", "Q"],
          budget: 2_400_000_000,
          revenue: 12_345_678_901,
          seasons: 41,
          episodes: 520,
          votes: 12_345_678,
        }
      : { status: undefined },
  };
}

function baseMeta(id: string): Meta | null {
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
const libraryTitles = WORST === "empty" ? [] : WORST ? [...series.slice(0, 10), ...movies.slice(0, 10)] : [...series.slice(0, 5), ...movies.slice(2, 9)];
export const library: LibraryItem[] = libraryTitles.map((m, k) => ({
  id: m.id,
  type: m.type,
  name: m.name,
  poster: m.poster,
  addedAt: now - k * 86_400_000,
}));

const progressTitles =
  WORST === "empty" ? [] : WORST ? [series[0], movies[0], series[2], movies[3], series[4]] : FILMS ? [...openFilms, series[1], movies[7]] : [series[1], movies[4], series[3], movies[0]];
export const progress: Progress[] = progressTitles.map((m, k) => ({
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
  // The open films' own lengths (Sintel 15 min, Tears of Steel 12, Big Buck Bunny 10).
  ...(FILMS && k < openFilms.length && { position: [310, 420, 200][k], duration: [888, 734, 596][k] }),
  updatedAt: now - k * 3_600_000,
  ...(WORST && { season: m.type === "series" ? 2024 : undefined, episode: m.type === "series" ? 9999 : undefined, episodeTitle: m.type === "series" ? `${W_LONG}, Part 9999` : undefined, position: [1, 359_999, 0, 5_000, 7_200][k], duration: [360_000, 360_000, 0, 4_000, 7_200][k] }),
}));

const W_ADDONS: InstalledAddon[] = [
  {
    manifestUrl: "https://addons.example/community-archive-of-restored-public-domain-cinema/configure/eyJsYW5ndWFnZXMiOlsiZW4iLCJqYSIsImFyIl19/manifest.json",
    manifest: {
      id: "org.example.community-archive-of-restored-public-domain-cinema",
      version: "12.345.6789-beta.12",
      name: "Community Archive of Restored Public-Domain Cinema (Volunteer Edition, EU West)",
      description: BLURB.repeat(4),
      types: ["movie", "series", "anime", "channel", "tv", "other"],
      resources: ["catalog", "meta", "stream", "subtitles", "addon_catalog"],
      behaviorHints: { configurable: true, configurationRequired: true },
      catalogs: [
        { type: "movie", id: "everything", name: `${W_LONG} Collection`, extra: [{ name: "skip" }, { name: "search" }] },
        { type: "series", id: "everything", name: "S", extra: [{ name: "genre", options: Array.from({ length: 60 }, (_, i) => `Genre ${i + 1}`) }] },
      ],
    },
  },
  { manifestUrl: "https://q.example/manifest.json", manifest: { id: "q", version: "0", name: "Q", types: [], resources: [], behaviorHints: null } },
];

export const addons: InstalledAddon[] = WORST === "empty" ? [] : WORST ? W_ADDONS : [
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
  // Lists of titles only (#206): two Home rows, a search, one that never answers, and lists Polarity can't show.
  {
    manifestUrl: "https://addons.example/lists/manifest.json",
    manifest: {
      id: "example.lists",
      version: "0.2.0",
      name: "Example Lists",
      description: "Hand-picked lists of public-domain films and shows.",
      types: ["movie", "series"],
      resources: ["catalog"],
      behaviorHints: { configurable: false, configurationRequired: false },
      catalogs: [
        { type: "movie", id: "picks", name: "Staff Picks", extra: [{ name: "genre", options: ["Drama", "Comedy"] }, { name: "skip" }] },
        { type: "series", id: "weekend", name: "Weekend Series" },
        { type: "movie", id: "late", name: "Late Night" },
        { type: "movie", id: "find", name: "Search", extra: [{ name: "search", isRequired: true }] },
        { type: "channel", id: "radio", name: "Radio" },
        { type: "movie", id: "by-year", name: "By Year", extra: [{ name: "year", isRequired: true }] },
      ],
    },
  },
];

/**
 * Example Lists' answers (`addon_catalog`): Staff Picks pages by 4 and filters by genre, Late Night fails
 * the way a timed-out add-on does, Search matches names.
 */
export function addonCatalog(addon: string, type: string, id: string, extra: [string, string][]): MetaPreview[] | Promise<never> {
  const arg = Object.fromEntries(extra);
  const list = type === "series" ? series : movies;
  if (addon !== "example.lists" || id === "late") return Promise.reject({ code: "upstream", message: "Example Lists took too long to answer" });
  if (id === "find") return list.filter((m) => m.name.toLowerCase().includes(String(arg.search).toLowerCase())).slice(0, 6);
  if (id === "weekend") return list.slice(2, 10);
  const genre = arg.genre === "Comedy" ? list.slice(6) : list;
  const skip = Number(arg.skip ?? 0);
  return genre.slice(skip, skip + 4);
}

function worstStreams(): StreamsResult {
  const big = "Community Archive of Restored Public-Domain Cinema (Volunteer Edition, EU West)";
  const file = "The.Extraordinarily.Long.and.Winding.Chronicle.of.the.Lighthouse.Keepers.Seventh.Daughter.2087.2160p.WEB-DL.DV.HDR10Plus.Atmos.TrueHD.7.1.10bit.HEVC-ARCHIVEGROUP.mkv";
  const rows: [string, number | undefined, number | undefined, string][] = [
    [big, 4320, 187.4e9, `${file}\n${BLURB}`],
    ["Q", undefined, undefined, ""],
    [big, 2160, 1, "夜明けの図書館と七つの鍵 第9999話 「最終回」 [多言語字幕]"],
    ["حكايات", 1080, 999_999_999_999, "حكايات البحر الأخير — النسخة الكاملة المرممة"],
    ["🦊", 240, 0, "🦊🌙✨ multi-audio multi-subs 🎬"],
    ...Array.from({ length: 35 }, (_, k): [string, number, number, string] => [k % 2 ? big : "Open Films", [2160, 1080, 720, 480][k % 4], (k + 1) * 1.1e9, `Source ${k + 6}`]),
  ];
  return {
    streams: rows.map(([addon, resolution, sizeBytes, title], k) => ({
      addon,
      stream: { url: `https://media.example/${k}.mp4`, name: k === 1 ? "" : `${addon}\n${resolution ?? "?"}p`, title, description: k === 0 ? title : undefined },
      quality: {
        resolution, hdr: k === 0, dolbyVision: k === 0, sizeBytes, lowQualitySource: k === 4, direct: k !== 3,
        languages: k === 0 ? ["en", "ja", "ar", "vi", "de", "fr", "es", "it", "ko", "zh", "ru", "pt", "hi", "multi"] : [],
        tags: k === 0 ? ["Remux", "Atmos", "TrueHD 7.1", "HDR10+", "Dolby Vision Profile 8.1", "10-bit", "HEVC", "IMAX Enhanced"] : [],
        source: k === 0 ? "ARCHIVEGROUP-RESTORATION-TEAM-INTERNATIONAL" : null,
      },
      label: resolution ? `${resolution}p` : "",
    })),
    failed: [big, "Q", "حكايات"],
    hidden: 1284,
  };
}

/** A made-up key in the fake sources' links and headers: no screen or copied text may show it (#229). */
export const FAKE_KEY = "TOKEN0000000000000000000000000001";

/** Browser tests of torrent sources (#137) set this: every source is then a made-up torrent. */
export const TORRENTS = localStorage.getItem("polar.fakeTorrents") === "1";

export function streams(): StreamsResult {
  if (WORST === "empty") return { streams: [], failed: [] };
  if (WORST) return worstStreams();
  if (TORRENTS)
    return {
      streams: [1080, 720].map((resolution, k) => ({
        addon: "Open Films",
        stream: { infoHash: String(k).repeat(40), fileIdx: 0, name: `Open Films\n${resolution}p`, title: "WEB-DL" },
        quality: { resolution, hdr: false, dolbyVision: false, sizeBytes: 2e9, lowQualitySource: false, direct: false, languages: ["en"], tags: [] },
        label: `${resolution}p`,
      })),
      failed: [],
    };
  // Two add-ons and four picture sizes: the source bar shows all its controls (quality, add-on, Filters).
  const rows: [string, number, boolean, number, string][] = [
    ["Open Films", 2160, true, 14.2e9, "WEB-DL HDR10"],
    ["Open Films", 1080, false, 4.1e9, "WEB-DL"],
    ["Open Films", 720, false, 1.6e9, "WEB"],
    ["Open Mirror", 1080, false, 3.9e9, "WEB-DL"],
    ["Open Mirror", 480, false, 0.7e9, "DVD"],
  ];
  return {
    streams: rows.map(([addon, resolution, hdr, sizeBytes, title], k) => ({
      addon,
      // The last source carries made-up keys where add-ons put theirs: the source info panel masks them (#229).
      stream:
        k === rows.length - 1
          ? {
              url: `https://media.example/token/${FAKE_KEY}/${k}.mp4?apikey=${FAKE_KEY}`,
              name: `${addon}\n${resolution}p`,
              title,
              description: `Mirror https://mirror.example.org/${FAKE_KEY}/film.mkv apikey=${FAKE_KEY}`,
              behaviorHints: { filename: "Open.Film.480p.DVD.mkv", bingeGroup: "open-mirror-480", proxyHeaders: { request: { Authorization: `Bearer ${FAKE_KEY}` } } },
            }
          : { url: `https://media.example/${k}.mp4`, name: `${addon}\n${resolution}p`, title },
      quality: { resolution, hdr, dolbyVision: false, sizeBytes, lowQualitySource: false, direct: true, languages: ["en"], tags: hdr ? ["HDR10"] : [] },
      label: `${resolution}p`,
      requestId: "tt0000001",
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
  animeAudioLanguage: "same",
  animeSubtitleLanguage: "same",
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
