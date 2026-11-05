import { useEffect, useMemo, useRef, useState } from "react";
import { languageName, langMatches } from "./languages";
import { formatBytes } from "../format";
import type { RankedStream, Settings, SourceSort } from "../types";

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
export const AUTO_TAG_CHOICES = ["dv", "hdr", "hdr10+", "remux", "atmos", "hevc", "10-bit"];

export function tagsOf(r: RankedStream): string[] {
  const q = r.quality;
  const t: string[] = [];
  if (q.dolbyVision) t.push("dv");
  if (q.hdr) t.push("hdr");
  for (const x of q.tags ?? []) t.push(x.toLowerCase());
  if (q.codec) t.push(q.codec.toLowerCase());
  return t;
}

/** Sources that say nothing about their audio are counted as English (the usual original). */
const langsOf = (r: RankedStream) => (r.quality.languages?.length ? r.quality.languages : ["en"]);

const GB = 1e9;

export const languageLabel = (code: string) => (code === "multi" ? "Multi-audio" : (languageName(code) ?? code.toUpperCase()));

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
    // A source the add-on says nothing about still gets a title, not an empty line.
    title: r.label.replace(/ · [\d.]+ [MGT]B$/, "") || "Unknown quality",
    size: r.quality.sizeBytes ? formatBytes(r.quality.sizeBytes) : null,
    detail: [r.addon, r.quality.source, languagesShort(r.quality.languages)].filter(Boolean).join(" · "),
  };
}

// --- Sorting -------------------------------------------------------------

const res = (r: RankedStream) => r.quality.resolution ?? 0;
const size = (r: RankedStream) => r.quality.sizeBytes ?? 0;

/**
 * "Best match", aware of this screen: on a 1080p (or smaller) display a 4K
 * file is a bigger download for no visible gain, so it ranks as if it were a
 * notch lower.
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
};

export function compareBy(sort: SourceSort, screen: number, preferScreen: boolean) {
  switch (sort) {
    case "quality":
      return (a: RankedStream, b: RankedStream) => res(b) - res(a) || size(b) - size(a);
    case "sizeDesc":
      return (a: RankedStream, b: RankedStream) => size(b) - size(a);
    case "sizeAsc":
      return (a: RankedStream, b: RankedStream) => (size(a) || Infinity) - (size(b) || Infinity);
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
  /** Release group or site (StreamQuality.source). */
  source: string | null;
}

export const NO_FILTER: SourceFilter = { addon: null, res: null, lang: null, size: null, tags: [], source: null };

/**
 * Whether a source has this audio language. "Multi-audio" (MULTI, Dual Audio)
 * releases rarely list what's inside, but almost always carry the original
 * and English: they count for every language, so asking for Japanese still
 * finds the dual-audio anime release. The Multi-audio choice itself is only those.
 */
function hasLanguage(r: RankedStream, code: string) {
  const langs = langsOf(r);
  return langs.includes(code) || (code !== "multi" && langs.includes("multi"));
}

export function matches(r: RankedStream, f: SourceFilter, skip?: keyof SourceFilter) {
  if (skip !== "addon" && f.addon && r.addon !== f.addon) return false;
  if (skip !== "res" && f.res && resKey(r) !== f.res) return false;
  if (skip !== "lang" && f.lang && !hasLanguage(r, f.lang)) return false;
  if (skip !== "source" && f.source && r.quality.source !== f.source) return false;
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
 * The order the player tries sources in on its own (auto-pick): CAM rips out,
 * the filters you set in the player for this show if they leave something
 * (so the next episode is the same kind of file), else the list's default
 * filters if they do, best match (or your sort) first.
 */
export function autoPickOrder(streams: RankedStream[], settings?: Settings, show?: string) {
  const playable = streams.filter((s) => !s.quality.lowQualitySource);
  const kept = show ? playerChoices.get(show) : undefined;
  const yours = kept ? playable.filter((r) => matches(r, kept.filter)) : [];
  const f = defaultFilter(playable, settings);
  const preferred = yours.length ? yours : playable.filter((r) => matches(r, f));
  const pool = preferred.length ? preferred : playable;
  const cmp = compareBy(kept?.sort ?? "best", screenResolution(), settings?.preferScreenResolution ?? true);
  return pool.map((r, i) => ({ r, i })).sort((a, b) => cmp(a.r, b.r) || a.i - b.i).map(({ r }) => r);
}

/**
 * The filters and sort you set in the player, per show, while it stays open.
 * The player is rebuilt for every episode and every source you pick
 * (PlayerLayer keys it on both), which used to put them back to the defaults
 * each time. PlayerLayer forgets them when the player closes; the title
 * page's source lists aren't affected.
 */
const playerChoices = new Map<string, { filter: SourceFilter; sort: SourceSort }>();

/** The player closed: its next visit starts from the defaults again. */
export const forgetPlayerSourceChoices = () => playerChoices.clear();

export interface Facet<K extends string = string> {
  key: K;
  label: string;
  count: number;
}

/**
 * A source list's filters, sort and the resulting view. Each facet counts
 * what the *other* filters leave, so a choice never shows a dead end. The
 * defaults apply once, when the list first arrives.
 *
 * `show`: the player's list for this show. It starts from what you last set
 * in the player for it (while the player stays open), as long as that leaves
 * something here, and remembers what you change.
 */
export function useSourceFilters(streams: RankedStream[] | undefined, settings: Settings | undefined, show?: string) {
  const [filter, setFilter] = useState<SourceFilter>(NO_FILTER);
  const [sort, setSortState] = useState<SourceSort>(
    () => (show && playerChoices.get(show)?.sort) || (settings?.sourceSort && settings.sourceSort in SORTS ? settings.sourceSort : "best"),
  );
  const seeded = useRef<RankedStream[] | null>(null);
  useEffect(() => {
    if (!streams?.length || seeded.current === streams) return;
    const first = seeded.current == null;
    seeded.current = streams;
    if (!first) return;
    const kept = show ? playerChoices.get(show)?.filter : undefined;
    setFilter(kept && streams.some((r) => matches(r, kept)) ? kept : defaultFilter(streams, settings));
  }, [streams, settings, show]);

  // Only your own changes are remembered, not the defaults a list opens with.
  const touched = useRef(false);
  useEffect(() => {
    if (show && touched.current) playerChoices.set(show, { filter, sort });
  }, [show, filter, sort]);
  const change = (next: (f: SourceFilter) => SourceFilter) => {
    touched.current = true;
    setFilter(next);
  };
  const setSort = (s: SourceSort) => {
    touched.current = true;
    setSortState(s);
  };

  const screen = useMemo(screenResolution, []);
  const screenRes = useMemo(screenResKey, []);
  const preferScreen = settings?.preferScreenResolution ?? true;
  // Settings → Sources: filters narrow the list, or only order it.
  const hide = settings?.sourceFiltersHide ?? false;
  const all = streams ?? [];

  const view = useMemo(() => {
    const cmp = compareBy(sort, screen, preferScreen);
    return all
      .map((r, i) => ({ r, i }))
      .map((x) => ({ ...x, match: matches(x.r, filter) }))
      .filter((x) => !hide || x.match)
      // Without hiding, what matches comes first and the rest follows, each in sort order.
      .sort((a, b) => Number(b.match) - Number(a.match) || cmp(a.r, b.r) || a.i - b.i);
  }, [all, filter, sort, screen, preferScreen, hide]);
  /** How many of `view`, from the top, match the filters (the rest are "other sources"). */
  const matched = view.filter((x) => x.match).length;

  const facets = useMemo(() => {
    const count = <K extends string>(skip: keyof SourceFilter, keyOf: (r: RankedStream) => K[]) => {
      const m = new Map<K, number>();
      for (const r of all) if (matches(r, filter, skip)) for (const k of new Set(keyOf(r))) m.set(k, (m.get(k) ?? 0) + 1);
      return m;
    };
    const addons = count("addon", (r) => [r.addon]);
    const sourceCounts = count("source", (r) => (r.quality.source ? [r.quality.source] : []));
    const resCounts = count("res", (r) => [resKey(r)]);
    // Multi-audio sources count toward every language (as they match it).
    const langCodes = [...new Set(all.flatMap(langsOf))];
    const langs = new Map(langCodes.map((c) => [c, all.filter((r) => matches(r, filter, "lang") && hasLanguage(r, c)).length]));
    // Tags narrow together (all of them must match): count within what's shown.
    const tagCounts = new Map<string, number>();
    for (const { r, match } of view) if (match) for (const t of new Set(tagsOf(r))) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    const base = matched;
    const sizes = all.map((r) => r.quality.sizeBytes ?? 0).filter((b) => b > 0);
    const maxGb = sizes.length ? Math.ceil(Math.max(...sizes) / GB) : 0;
    return {
      addons: [...new Set(all.map((r) => r.addon))].map((a) => ({ key: a, label: a, count: addons.get(a) ?? 0 })),
      // Most sources first; a group with one file isn't much of a choice, but stays findable.
      sources: [...new Set(all.flatMap((r) => (r.quality.source ? [r.quality.source] : [])))]
        .map((k) => ({ key: k, label: k, count: sourceCounts.get(k) ?? 0 }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      res: (["2160", "1080", "720", "other"] as ResKey[])
        .filter((k) => all.some((r) => resKey(r) === k))
        .map((k) => ({ key: k, label: RES_LABELS[k], count: resCounts.get(k) ?? 0 })),
      langs: langCodes
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
    !!filter.addon || !!filter.res || !!filter.lang || !!filter.size || !!filter.source || filter.tags.length > 0;

  return {
    filter,
    set: (patch: Partial<SourceFilter>) => change((f) => ({ ...f, ...patch })),
    toggleTag: (t: string) =>
      change((f) => ({ ...f, tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] })),
    clear: () => change(() => NO_FILTER),
    active,
    sort,
    setSort,
    /** The visible sources, each with its index in the ranked list (ids stay stable). */
    view,
    matched,
    /** Filters order the list rather than hide (Settings → Sources). */
    soft: !hide,
    total: all.length,
    facets,
    screenRes,
  };
}

export type SourceFilters = ReturnType<typeof useSourceFilters>;
