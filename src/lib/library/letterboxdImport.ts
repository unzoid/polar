import type { LibraryItem, MetaPreview, Progress } from "../types";
import { zipText } from "./zipText";

/**
 * Reading the export Letterboxd gives from its settings (a ZIP of CSV files) into Polarity's library
 * and watched films (#87). Only the file: nothing here talks to Letterboxd, and its `boxd.it` links are
 * never followed. The export has no IMDb or TMDB ids, so each film is matched by title and year through
 * the catalog Polarity already uses (`api.searchMovies`); rows that match nothing, or more than one
 * film, are left for the user to pick.
 */

/** One film from the export, every file's rows about it put together. Times are ms. */
export interface LetterboxdFilm {
  /** The normalised title and year: how rows of different files are joined. */
  key: string;
  name: string;
  year?: number;
  /** An IMDb id, when the file has one (Letterboxd's import format does; its export doesn't). */
  imdb?: string;
  /** On the watchlist since. */
  watchlistAt?: number;
  /** Watched or logged, at the latest date the files give. */
  watchedAt?: number;
  /** Stars, 0.5–5 (read for the summary; Polarity has no rating to put it in). */
  rating?: number;
}

export interface LetterboxdExport {
  films: LetterboxdFilm[];
  /** Rows without a title, or files whose columns aren't a Letterboxd list's. */
  unreadable: number;
}

/** The export's files Polarity reads, by name; `reviews.csv`, `likes/` and `lists/` aren't. */
const FILES = ["watched.csv", "diary.csv", "ratings.csv", "watchlist.csv"] as const;
type FileName = (typeof FILES)[number];

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and line breaks. A leading BOM is dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (s[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows.filter((r) => r.some((f) => f.trim()));
}

/** A title as the matcher compares it: accents, case and punctuation ignored, "&" read as "and". */
export function normaliseTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The first year a catalog's `releaseInfo` gives ("2001", "2001–2004"). */
export function yearOf(releaseInfo: string | undefined): number | undefined {
  const m = releaseInfo?.match(/\b(\d{4})\b/);
  return m ? Number(m[1]) : undefined;
}

/** A `YYYY-MM-DD` day as noon local time, so it stays the same day in every zone near the user's. */
function day(value: string | undefined): number | undefined {
  const m = value?.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime();
  return Number.isFinite(t) ? t : undefined;
}

const later = (a: number | undefined, b: number | undefined) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));

/** The export's own file name for a path, or undefined. The shallowest copy wins; deleted/orphaned folders are skipped. */
function exportFile(path: string): FileName | undefined {
  const parts = path.toLowerCase().split("/");
  if (parts.slice(0, -1).some((p) => p === "deleted" || p === "orphaned" || p === "lists" || p === "likes")) return undefined;
  return FILES.find((f) => f === parts[parts.length - 1]);
}

/** Which of the export's files these are, by name, the shallowest path for each. */
export function pickExportFiles(files: { path: string; text: string }[]): Map<FileName, string> {
  const picked = new Map<FileName, { depth: number; text: string }>();
  for (const f of files) {
    const name = exportFile(f.path);
    const depth = f.path.split("/").length;
    if (name && (picked.get(name)?.depth ?? Infinity) > depth) picked.set(name, { depth, text: f.text });
  }
  return new Map([...picked].map(([k, v]) => [k, v.text]));
}

/**
 * Reads the export's files (`watched.csv`, `diary.csv`, `ratings.csv`, `watchlist.csv`, by name).
 * Throws when none of them is there or none has Letterboxd's columns.
 */
export function parseLetterboxdExport(files: Map<string, string>): LetterboxdExport {
  const films = new Map<string, LetterboxdFilm>();
  let unreadable = 0;
  let read = 0;
  for (const name of FILES) {
    const text = files.get(name);
    if (text === undefined) continue;
    const [head, ...rows] = parseCsv(text);
    const col = new Map((head ?? []).map((h, i) => [h.trim().toLowerCase(), i]));
    const at = (row: string[], key: string) => {
      const i = col.get(key);
      return i === undefined ? undefined : row[i]?.trim() || undefined;
    };
    if (!col.has("name")) {
      unreadable++;
      continue;
    }
    read++;
    for (const row of rows) {
      const title = at(row, "name");
      if (!title) {
        unreadable++;
        continue;
      }
      const y = Number(at(row, "year"));
      const year = Number.isInteger(y) && y > 1800 ? y : undefined;
      const key = `${normaliseTitle(title)}|${year ?? ""}`;
      const film = films.get(key) ?? { key, name: title, year };
      const imdb = at(row, "imdbid")?.match(/^tt\d+$/)?.[0];
      if (imdb) film.imdb = imdb;
      const date = day(at(row, "date"));
      if (name === "watchlist.csv") film.watchlistAt = later(film.watchlistAt, date ?? 0);
      else film.watchedAt = later(film.watchedAt, day(at(row, "watched date")) ?? date ?? 0);
      if (name === "ratings.csv") {
        const stars = Number(at(row, "rating"));
        if (stars > 0 && stars <= 5) film.rating = stars;
      }
      films.set(key, film);
    }
  }
  if (!read) throw new Error("This isn't a Letterboxd export: it has no watched, diary, ratings or watchlist file.");
  return { films: [...films.values()], unreadable };
}

/** The most a picked file may hold before it's read into memory. Exports of thousands of films are a few MB. */
export const MAX_PICKED_BYTES = 200 * 1024 * 1024;

/**
 * Reads what the user picked: the export's ZIP, or its CSV files picked one by one. Throws when it holds
 * nothing Polarity reads.
 */
export async function readLetterboxdFiles(files: { name: string; size: number; bytes: () => Promise<Uint8Array<ArrayBuffer>> }[]): Promise<LetterboxdExport> {
  const texts: { path: string; text: string }[] = [];
  for (const f of files) {
    if (f.size > MAX_PICKED_BYTES) throw new Error(`${f.name} is too large for a Letterboxd export.`);
    const bytes = await f.bytes();
    if (/\.zip$/i.test(f.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      for (const [path, text] of await zipText(bytes, (p) => !!exportFile(p))) texts.push({ path, text });
    } else texts.push({ path: f.name, text: new TextDecoder().decode(bytes) });
  }
  return parseLetterboxdExport(pickExportFiles(texts));
}

/** What the catalog's results make of a film: the one film it is, or the ones to pick from (maybe none). */
export type FilmMatch = { found: MetaPreview } | { choose: MetaPreview[] };

/** At most this many films offered to pick from. */
const CHOICES = 5;

/**
 * The film a row is, from a catalog search: exactly one result with the same normalised title and the
 * same year, else exactly one a year off (databases differ on release years). Anything else is left to
 * the user, offering same-title results first, then those of a near year.
 */
export function pickMatch(film: LetterboxdFilm, results: MetaPreview[]): FilmMatch {
  const title = normaliseTitle(film.name);
  const movies = results.filter((r) => r.type === "movie" && /^tt\d+$/.test(r.id));
  const same = movies.filter((r) => normaliseTitle(r.name) === title);
  if (film.year !== undefined) {
    const off = (r: MetaPreview) => Math.abs((yearOf(r.releaseInfo) ?? -9) - film.year!);
    const exact = same.filter((r) => off(r) === 0);
    if (exact.length === 1) return { found: exact[0] };
    if (exact.length > 1) return { choose: exact.slice(0, CHOICES) };
    const near = same.filter((r) => off(r) === 1);
    if (near.length === 1) return { found: near[0] };
    const rest = movies.filter((r) => off(r) <= 1 && !same.includes(r));
    return { choose: [...same, ...rest].slice(0, CHOICES) };
  }
  return same.length === 1 ? { found: same[0] } : { choose: (same.length ? same : movies).slice(0, CHOICES) };
}

/**
 * Finds one film: by its IMDb id when the file gives one, else a search narrowed to its year, then (when
 * that settles nothing) the plain search, which also holds the films a year off.
 */
export async function matchFilm(film: LetterboxdFilm, search: (query: string, year?: number) => Promise<MetaPreview[]>): Promise<FilmMatch> {
  if (film.imdb) return { found: { id: film.imdb, type: "movie", name: film.name, releaseInfo: film.year ? String(film.year) : undefined } };
  const first = film.year !== undefined ? pickMatch(film, await search(film.name, film.year)) : undefined;
  if (first && "found" in first) return first;
  const second = pickMatch(film, await search(film.name));
  if ("found" in second || !first) return second;
  // Keep the narrowed search's picks first, then the plain search's, each film once.
  const seen = new Set(first.choose.map((m) => m.id));
  return { choose: [...first.choose, ...second.choose.filter((m) => !seen.has(m.id))].slice(0, CHOICES) };
}

export interface LetterboxdChoice {
  watchlist: boolean;
  watched: boolean;
}

export interface LetterboxdPlan {
  library: LibraryItem[];
  progress: Progress[];
}

/**
 * What to import for the films matched so far (`matched`: film key → catalog film): watchlist films into
 * the library, added when they were added there; watched films marked watched at their latest date. Two
 * rows matched to the same film give one entry, the later time.
 */
export function planLetterboxdImport(films: LetterboxdFilm[], matched: Map<string, MetaPreview>, choice: LetterboxdChoice): LetterboxdPlan {
  const library = new Map<string, LibraryItem>();
  const progress = new Map<string, Progress>();
  for (const film of films) {
    const m = matched.get(film.key);
    if (!m) continue;
    const name = m.name || film.name;
    if (choice.watchlist && film.watchlistAt !== undefined && (library.get(m.id)?.addedAt ?? -1) < film.watchlistAt) {
      library.set(m.id, { id: m.id, type: "movie", name, poster: m.poster, addedAt: film.watchlistAt });
    }
    if (choice.watched && film.watchedAt !== undefined && (progress.get(m.id)?.updatedAt ?? -1) < film.watchedAt) {
      progress.set(m.id, {
        metaId: m.id,
        videoId: m.id,
        type: "movie",
        name,
        poster: m.poster,
        background: m.background,
        position: 1,
        duration: 1,
        updatedAt: film.watchedAt,
      });
    }
  }
  return { library: [...library.values()], progress: [...progress.values()] };
}
