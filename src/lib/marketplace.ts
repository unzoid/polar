import { useQuery } from "@tanstack/react-query";
import { appVersion } from "./updater";

/**
 * The Marketplace catalogue: add-ons the app lists itself, read from the
 * github.com/unzoid/polarity-addons repository so it can grow without an app
 * update (and anyone can propose one with a pull request). A copy is bundled
 * for first launch and offline use.
 *
 * Only add-ons for lawful content belong there, and the app must not list
 * any other kind. An add-on pasted under Add-ons → Install from URL is the
 * user's own choice and responsibility.
 */
export const MARKETPLACE_URL = "https://raw.githubusercontent.com/unzoid/polarity-addons/main/addons.json";
export const MARKETPLACE_REPO = "https://github.com/unzoid/polarity-addons";

export type MarketCategory = "Subtitles" | "Streams" | "Metadata";

/** Categories this version can use, in the order they're shown. ("Catalogs" waits for add-on catalog support.) */
export const MARKET_CATEGORIES: MarketCategory[] = ["Subtitles", "Streams", "Metadata"];

export interface MarketAddon {
  /** The add-on's own manifest id, to tell whether it's installed. */
  manifestId: string;
  name: string;
  author: string;
  about: string;
  category: MarketCategory;
  tags: string[];
  /** Where Install fetches it from. */
  install: string;
  /** The add-on's own setup page (an account, a key, options). */
  configure?: string;
  /** Can't be installed until it's set up on `configure`. */
  setupRequired?: boolean;
  homepage?: string;
}

/** The bundled copy: what the repository held when this version shipped. */
const BUNDLED: MarketAddon[] = [
  {
    manifestId: "org.stremio.opensubtitlesv3",
    name: "OpenSubtitles",
    author: "OpenSubtitles",
    about: "Subtitles in dozens of languages for movies and series, found for you as soon as you start watching.",
    category: "Subtitles",
    tags: ["subtitles", "captions", "languages", "official"],
    install: "https://opensubtitles-v3.strem.io/manifest.json",
    homepage: "https://www.opensubtitles.com",
  },
  {
    manifestId: "community.opensubtitlesv3.pro",
    name: "OpenSubtitles PRO",
    author: "dexter21767",
    about: "OpenSubtitles with your own account: better matching, more results and AI-translated subtitles when nothing else exists.",
    category: "Subtitles",
    tags: ["subtitles", "captions", "opensubtitles", "account", "translation"],
    install: "https://opensubtitlesv3-pro.dexter21767.com/manifest.json",
    configure: "https://opensubtitlesv3-pro.dexter21767.com/configure",
    setupRequired: true,
  },
  {
    manifestId: "community.subdl.subtitles",
    name: "SubDL",
    author: "SubDL",
    about: "A large subtitle library with strong coverage of anime and non-English releases. Needs a free SubDL API key.",
    category: "Subtitles",
    tags: ["subtitles", "captions", "anime", "languages"],
    install: "https://subdl.strem.top/manifest.json",
    configure: "https://subdl.strem.top/configure",
    setupRequired: true,
    homepage: "https://subdl.com",
  },
  {
    manifestId: "community.subsource.subtitles",
    name: "SubSource",
    author: "SubSource",
    about: "Community-made subtitles, often the first place new episodes get them. Needs a free SubSource API key.",
    category: "Subtitles",
    tags: ["subtitles", "captions", "community", "anime"],
    install: "https://subsource.strem.top/manifest.json",
    configure: "https://subsource.strem.top/configure",
    setupRequired: true,
    homepage: "https://subsource.net",
  },
  {
    manifestId: "org.stremio.watchhub",
    name: "WatchHub",
    author: "Stremio",
    about: "Where a title is streaming legally (Netflix, Prime Video, Disney+ and more), opened in the service's own app or site.",
    category: "Streams",
    tags: ["streaming services", "netflix", "prime video", "disney", "legal", "official"],
    install: "https://watchhub.strem.io/manifest.json",
  },
];

/** "1.2.3" ≥ "1.2.0"? Anything unparseable (a dev build) counts as new enough. */
function atLeast(version: string, min: string) {
  const a = version.split(".").map(Number);
  const b = min.split(".").map(Number);
  if (a.some(Number.isNaN)) return true;
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const https = (v: unknown) => (str(v)?.startsWith("https://") ? (v as string) : undefined);

/** The repository's file, read defensively: entries this version can't use are skipped, not fatal. */
function parse(json: unknown, version: string): MarketAddon[] {
  const list = (json as { addons?: unknown })?.addons;
  if (!Array.isArray(list)) throw new Error("Marketplace list is malformed");
  const out: MarketAddon[] = [];
  for (const raw of list) {
    const a = raw as Record<string, unknown>;
    const manifestId = str(a.id);
    const name = str(a.name);
    const install = https(a.manifest);
    const category = a.category as MarketCategory;
    if (!manifestId || !name || !install || !MARKET_CATEGORIES.includes(category)) continue;
    if (str(a.minAppVersion) && !atLeast(version, a.minAppVersion as string)) continue;
    out.push({
      manifestId,
      name,
      author: str(a.author) ?? "",
      about: str(a.about) ?? "",
      category,
      tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === "string") : [],
      install,
      configure: https(a.configure),
      setupRequired: a.setupRequired === true && !!https(a.configure),
      homepage: https(a.homepage),
    });
  }
  return out;
}

async function fetchMarketplace(): Promise<MarketAddon[]> {
  const [res, version] = await Promise.all([fetch(MARKETPLACE_URL, { cache: "no-cache" }), appVersion()]);
  if (!res.ok) throw new Error(`Marketplace answered ${res.status}`);
  return parse(await res.json(), version);
}

/** The live list, refreshed every few hours; the bundled copy until it arrives (or if it can't). */
export function useMarketplace() {
  const q = useQuery({
    queryKey: ["marketplace"],
    queryFn: fetchMarketplace,
    staleTime: 3 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
  });
  return { addons: q.data ?? BUNDLED, live: !!q.data, failed: q.isError && !q.data };
}

/** Entries matching a search: name, author, category, tags and description. */
export function searchMarketplace(items: MarketAddon[], query: string): MarketAddon[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((a) => {
    const hay = `${a.name} ${a.author} ${a.category} ${a.tags.join(" ")} ${a.about}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
