import { useEffect, useMemo, useRef, useState } from "react";
import { languageName, langMatches } from "./languages";
import type { RankedStream, Settings, SourceSort } from "./types";

/**
 * Filtering and sorting a title's sources, shared by every source list (the
 * title page's sheet, TV mode's panel and the player's picker):
 *
 *  - which add-on, which resolution, which audio language;
 *  - a file-size range;
 *  - tags (Dolby Vision, HDR, Remux, Atmos…) that narrow the list one by one,
 *    some switched on by themselves when available (Settings → Sources);
 *  - "Best match" that knows this screen: no 4K first on a 1080p display.
 */

// --- This screen ---------------------------------------------------------

/** The display's real height in pixels (zoom and scaling don't fool it), as a video resolution. */
export function screenResolution(): number {
  const w = Math.round(window.screen.width * window.devicePixelRatio);
  const h = Math.round(window.screen.height * window.devicePixelRatio);
  const tall = Math.min(w, h);
  if (tall >= 2000 || Math.max(w, h) >= 3800) return 2160;
  if (tall >= 1300) return 1440;
  if (tall >= 1000) return 1080;
  if (tall >= 700) return 720;
  return 480;
}

// --- Facets --------------------------------------------------------------

export type ResKey = "2160" | "1080" | "720" | "other";

export const RES_LABELS: Record<ResKey, string> = { "2160": "4K", "1080": "1080p", "720": "720p", other: "SD / Unknown" };

export const resKey = (r: RankedStream): ResKey => {
  const v = r.quality.resolution;
  if (v === 2160) return "2160";
  if (v === 1080 || v === 1440) return "1080";
  if (v === 720) return "720";
  return "other";
};

/** The resolution bucket that suits this screen. */
export const screenResKey = (): ResKey => {
  const s = screenResolution();
  return s >= 2160 ? "2160" : s >= 1080 ? "1080" : "720";
};

/** Tag keys, in the order the chips show. */
export const TAG_LABELS: Record<string, string> = {
  instant: "Instant",
  dv: "Dolby Vision",
  "hdr10+": "HDR10+",
  hdr: "HDR",
  remux: "Remux",
  atmos: "Atmos",
  truehd: "TrueHD",
  "dts:x": "DTS:X",
  "dts-hd": "DTS-HD",
  "7.1": "7.1",
  "5.1": "5.1",
  "10-bit": "10-bit",
  hevc: "HEVC",
  av1: "AV1",
  "h.264": "H.264",
  imax: "IMAX",
  "3d": "3D",
  bluray: "BluRay",
  "web-dl": "WEB",
};

/** Tags offered in Settings → Sources to switch on by themselves. */
export const AUTO_TAG_CHOICES = ["dv", "hdr", "hdr10+", "remux", "atmos", "instant", "hevc", "10-bit"];

export function tagsOf(r: RankedStream): string[] {
  const q = r.quality;
  const t: string[] = [];
  if (q.cached) t.push("instant");
  if (q.dolbyVision) t.push("dv");
  if (q.hdr) t.push("hdr");
  for (const x of q.tags ?? []) t.push(x.toLowerCase());
  if (q.codec) t.push(q.codec.toLowerCase());
  return t;
}

/** Sources that say nothing about their audio are counted as English (the usual original). */
const langsOf = (r: RankedStream) => (r.quality.languages?.length ? r.quality.languages : ["en"]);

export const languageLabel = (code: string) => (code === "multi" ? "Multi-audio" : (languageName(code) ?? code.toUpperCase()));

const GB = 1e9;

/** "12.4 GB" / "850 MB", as the ranker writes it. */
export const formatBytes = (b: number) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

/** "English, Italian +3": the first two audio languages, then a count. */
export function languagesShort(codes: string[] | undefined) {
  if (!codes?.length) return null;
  const names = codes.map(languageLabel);
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
}

/**
 * One source as a list row shows it: the picture ("4K · Dolby Vision · HEVC")
 * as the title, the size set apart, and the where-from as one quiet line.
 * The ranker's label ends in the size; it's split off so it can align right.
 */
export function sourceRow(r: RankedStream) {
  return {
    title: r.label.replace(/ · [\d.]+ [MG]B$/, ""),
    size: r.quality.sizeBytes ? formatBytes(r.quality.sizeBytes) : null,
    detail: [r.addon, languagesShort(r.quality.languages), r.quality.sources != null ? `${r.quality.sources} peers` : null]
      .filter(Boolean)
      .join(" · "),
  };
}

// --- Sorting -------------------------------------------------------------

const res = (r: RankedStream) => r.quality.resolution ?? 0;
const size = (r: RankedStream) => r.quality.sizeBytes ?? 0;

/**
 * "Best match", aware of this screen: on a 1080p (or smaller) display a 4K
 * file is a bigger download for no visible gain, so it ranks as if it were a
 * notch lower. Cached (instant) sources still come first.
 */
export function bestScore(r: RankedStream, screen: number, preferScreen: boolean) {
  const over = preferScreen && screen < 1300 && res(r) > Math.max(screen, 1080);
  return r.score - (over ? 8 : 0);
}

export const SORTS: Record<SourceSort, string> = {
  best: "Best Match",
  quality: "Highest Quality",
  sizeDesc: "Largest File",
  sizeAsc: "Smallest File",
  peers: "Most Peers",
};

export function compareBy(sort: SourceSort, screen: number, preferScreen: boolean) {
  switch (sort) {
    case "quality":
      return (a: RankedStream, b: RankedStream) => res(b) - res(a) || size(b) - size(a);
    case "sizeDesc":
      return (a: RankedStream, b: RankedStream) => size(b) - size(a);
    case "sizeAsc":
      return (a: RankedStream, b: RankedStream) => (size(a) || Infinity) - (size(b) || Infinity);
    case "peers":
      return (a: RankedStream, b: RankedStream) => (b.quality.sources ?? 0) - (a.quality.sources ?? 0);
    default:
      return (a: RankedStream, b: RankedStream) => bestScore(b, screen, preferScreen) - bestScore(a, screen, preferScreen);
  }
}

// --- Filter --------------------------------------------------------------

export interface SourceFilter {
  addon: string | null;
  res: ResKey | null;
  lang: string | null;
  /** GB, inclusive; null = any. Sources of unknown size always pass. */
  size: [number, number] | null;
  tags: string[];
}

export const NO_FILTER: SourceFilter = { addon: null, res: null, lang: null, size: null, tags: [] };

export function matches(r: RankedStream, f: SourceFilter, skip?: keyof SourceFilter) {
  if (skip !== "addon" && f.addon && r.addon !== f.addon) return false;
  if (skip !== "res" && f.res && resKey(r) !== f.res) return false;
  if (skip !== "lang" && f.lang && !langsOf(r).some((l) => l === f.lang)) return false;
  if (skip !== "size" && f.size && r.quality.sizeBytes) {
    const gb = r.quality.sizeBytes / GB;
    if (gb < f.size[0] - 0.05 || gb > f.size[1] + 0.05) return false;
  }
  if (skip !== "tags" && f.tags.length) {
    const has = tagsOf(r);
    if (!f.tags.every((t) => has.includes(t))) return false;
  }
  return true;
}

/**
 * The filters a list opens with: tags from Settings → Sources that some
 * source has, and the preferred audio language if any source offers it.
 */
export function defaultFilter(streams: RankedStream[], settings?: Settings): SourceFilter {
  const tags = (settings?.sourceAutoTags ?? []).filter((t) => streams.some((r) => tagsOf(r).includes(t)));
  // Only as far as something's left to play.
  const kept: string[] = [];
  for (const t of tags) {
    if (streams.some((r) => [...kept, t].every((k) => tagsOf(r).includes(k)))) kept.push(t);
  }
  const pref = settings?.audioLanguage;
  const lang =
    pref && !langMatches("en", pref) && streams.some((r) => r.quality.languages?.some((l) => langMatches(l, pref)))
      ? (streams.flatMap((r) => r.quality.languages ?? []).find((l) => langMatches(l, pref)) ?? null)
      : null;
  return { ...NO_FILTER, tags: kept, lang };
}

/**
 * The order the player tries sources in on its own (auto-pick): the list's
 * default filters when they leave something, CAM rips out, best match first.
 */
export function autoPickOrder(streams: RankedStream[], settings?: Settings) {
  const playable = streams.filter((s) => !s.quality.lowQualitySource);
  const f = defaultFilter(playable, settings);
  const preferred = playable.filter((r) => matches(r, f));
  const pool = preferred.length ? preferred : playable;
  const cmp = compareBy("best", screenResolution(), settings?.preferScreenResolution ?? true);
  return pool.map((r, i) => ({ r, i })).sort((a, b) => cmp(a.r, b.r) || a.i - b.i).map(({ r }) => r);
}

export interface Facet<K extends string = string> {
  key: K;
  label: string;
  count: number;
}

/**
 * A source list's filters, sort and the resulting view. Each facet counts
 * what the *other* filters leave, so a choice never shows a dead end. The
 * defaults apply once, when the list first arrives.
 */
export function useSourceFilters(streams: RankedStream[] | undefined, settings: Settings | undefined) {
  const [filter, setFilter] = useState<SourceFilter>(NO_FILTER);
  const [sort, setSort] = useState<SourceSort>(() => (settings?.sourceSort && settings.sourceSort in SORTS ? settings.sourceSort : "best"));
  const seeded = useRef<RankedStream[] | null>(null);
  useEffect(() => {
    if (!streams?.length || seeded.current === streams) return;
    const first = seeded.current == null;
    seeded.current = streams;
    if (first) setFilter(defaultFilter(streams, settings));
  }, [streams, settings]);

  const screen = useMemo(screenResolution, []);
  const screenRes = useMemo(screenResKey, []);
  const preferScreen = settings?.preferScreenResolution ?? true;
  const all = streams ?? [];

  const view = useMemo(() => {
    const cmp = compareBy(sort, screen, preferScreen);
    return all
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => matches(r, filter))
      .sort((a, b) => cmp(a.r, b.r) || a.i - b.i);
  }, [all, filter, sort, screen, preferScreen]);

  const facets = useMemo(() => {
    const count = <K extends string>(skip: keyof SourceFilter, keyOf: (r: RankedStream) => K[]) => {
      const m = new Map<K, number>();
      for (const r of all) if (matches(r, filter, skip)) for (const k of new Set(keyOf(r))) m.set(k, (m.get(k) ?? 0) + 1);
      return m;
    };
    const addons = count("addon", (r) => [r.addon]);
    const resCounts = count("res", (r) => [resKey(r)]);
    const langs = count("lang", langsOf);
    // Tags narrow together (all of them must match): count within what's shown.
    const tagCounts = new Map<string, number>();
    for (const { r } of view) for (const t of new Set(tagsOf(r))) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    const base = view.length;
    const sizes = all.map((r) => r.quality.sizeBytes ?? 0).filter((b) => b > 0);
    const maxGb = sizes.length ? Math.ceil(Math.max(...sizes) / GB) : 0;
    return {
      addons: [...new Set(all.map((r) => r.addon))].map((a) => ({ key: a, label: a, count: addons.get(a) ?? 0 })),
      res: (["2160", "1080", "720", "other"] as ResKey[])
        .filter((k) => all.some((r) => resKey(r) === k))
        .map((k) => ({ key: k, label: RES_LABELS[k], count: resCounts.get(k) ?? 0 })),
      langs: [...new Set(all.flatMap(langsOf))]
        .map((code) => ({ key: code, label: languageLabel(code), count: langs.get(code) ?? 0 }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      // A tag every listed source has filters nothing; leave it out unless it's on.
      tags: Object.keys(TAG_LABELS)
        .filter((k) => filter.tags.includes(k) || ((tagCounts.get(k) ?? 0) > 0 && (tagCounts.get(k) ?? 0) < base))
        .map((k) => ({ key: k, label: TAG_LABELS[k], count: tagCounts.get(k) ?? 0 })),
      maxGb,
    };
  }, [all, filter, view]);

  const active =
    !!filter.addon || !!filter.res || !!filter.lang || !!filter.size || filter.tags.length > 0;

  return {
    filter,
    set: (patch: Partial<SourceFilter>) => setFilter((f) => ({ ...f, ...patch })),
    toggleTag: (t: string) =>
      setFilter((f) => ({ ...f, tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] })),
    clear: () => setFilter(NO_FILTER),
    active,
    sort,
    setSort,
    /** The visible sources, each with its index in the ranked list (ids stay stable). */
    view,
    total: all.length,
    facets,
    screenRes,
  };
}

export type SourceFilters = ReturnType<typeof useSourceFilters>;
