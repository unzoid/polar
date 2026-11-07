import { afterEach, expect, test } from "bun:test";
import "./storageStub";
import { firstLook, localDay, outAt, whatsNew, type Show, type ShowMemory } from "../src/lib/notifications/whatsNew";
import { downloadNotes, newsBody, newsNotes } from "../src/lib/notifications/messages";
import type { Download } from "../src/lib/library/downloads";
import type { Meta, Video } from "../src/lib/types";
import { followed, runCheck, type CheckDeps } from "../src/lib/notifications/check";
import { loadMemory, payloadRoute, readMemory, routePayload } from "../src/lib/notifications/store";

// #209: what's new in a series, decided from the episode list alone. Made-up show, made-up ids.

const zone = process.env.TZ;
afterEach(() => {
  process.env.TZ = zone;
});

const ALL = { episodes: true, seasons: true };
const ep = (season: number, episode: number, released?: string): Video => ({
  id: `tt0000001:${season}:${episode}`,
  title: `Episode ${episode}`,
  season,
  episode,
  released,
});
const show = (videos: Video[]): Show => ({ id: "tt0000001", type: "series", name: "The Lighthouse Keepers", videos });
const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();

test("an air date is out at the start of that day where the user is", () => {
  for (const tz of ["America/Los_Angeles", "UTC", "Asia/Tokyo"]) {
    process.env.TZ = tz;
    // Listings write a calendar date, often as midnight UTC.
    expect(outAt("2026-11-07")).toBe(local(2026, 11, 7));
    expect(outAt("2026-11-07T00:00:00.000Z")).toBe(local(2026, 11, 7));
    // Not the UTC instant: in Los Angeles that's the evening before.
    if (tz !== "UTC") expect(outAt("2026-11-07T00:00:00.000Z")).not.toBe(Date.UTC(2026, 10, 7));
    // A real time of day is taken as written.
    expect(outAt("2026-11-07T21:30:00.000Z")).toBe(Date.UTC(2026, 10, 7, 21, 30));
    expect(outAt(undefined)).toBeNull();
    expect(outAt("soon")).toBeNull();
  }
});

test("west of Greenwich, an episode dated tomorrow isn't news this evening", () => {
  process.env.TZ = "America/Los_Angeles";
  const before = show([ep(1, 1, "2026-11-01T00:00:00.000Z")]);
  const memory = firstLook(before, local(2026, 11, 2));
  const next = show([...before.videos, ep(1, 2, "2026-11-08T00:00:00.000Z")]);
  // 7 November, 20:00 in Los Angeles is already 8 November in UTC.
  expect(whatsNew(next, memory, local(2026, 11, 7, 20), ALL).news).toBeUndefined();
  expect(whatsNew(next, memory, local(2026, 11, 8, 0), ALL).news?.videos.map((v) => v.episode)).toEqual([2]);
});

test("east of Greenwich, it's news from that local morning", () => {
  process.env.TZ = "Asia/Tokyo";
  const before = show([ep(1, 1, "2026-11-01")]);
  const memory = firstLook(before, local(2026, 11, 2));
  const next = show([...before.videos, ep(1, 2, "2026-11-08")]);
  expect(whatsNew(next, memory, local(2026, 11, 7, 23), ALL).news).toBeUndefined();
  expect(whatsNew(next, memory, local(2026, 11, 8, 7), ALL).news?.kind).toBe("episodes");
});

test("the first look announces nothing", () => {
  const s = show([ep(1, 1, "2026-01-01"), ep(1, 2, "2026-01-08"), ep(2, 1, "2026-12-01")]);
  const { news, memory } = whatsNew(s, undefined, local(2026, 11, 7), ALL);
  expect(news).toBeUndefined();
  expect(memory.known).toEqual([ep(1, 1).id, ep(1, 2).id]);
  expect(memory.seasons).toEqual([1]);
});

test("an episode with no date is never news, until a date comes and passes", () => {
  const memory = firstLook(show([ep(1, 1, "2026-11-01")]), local(2026, 11, 2));
  const undated = show([ep(1, 1, "2026-11-01"), ep(1, 2)]);
  const later = whatsNew(undated, memory, local(2026, 11, 9), ALL);
  expect(later.news).toBeUndefined();
  expect(later.memory.known).not.toContain(ep(1, 2).id);

  const dated = show([ep(1, 1, "2026-11-01"), ep(1, 2, "2026-11-10")]);
  expect(whatsNew(dated, later.memory, local(2026, 11, 9, 12), ALL).news).toBeUndefined();
  expect(whatsNew(dated, later.memory, local(2026, 11, 10, 9), ALL).news?.videos.map((v) => v.id)).toEqual([ep(1, 2).id]);
});

test("a whole season out at once is one notice about the season", () => {
  const before = show([ep(1, 1, "2026-01-01"), ep(1, 2, "2026-01-08")]);
  const memory = firstLook(before, local(2026, 2, 1));
  const season2 = Array.from({ length: 8 }, (_, i) => ep(2, i + 1, "2026-11-06"));
  const { news, memory: after } = whatsNew(show([...before.videos, ...season2]), memory, local(2026, 11, 7), ALL);
  expect(news?.kind).toBe("season");
  expect(news?.season).toBe(2);
  expect(news?.videos).toHaveLength(8);
  expect(newsBody(news!)).toBe("Season 2 is out: 8 episodes");
  expect(after.seasons).toEqual([1, 2]);
  // The next episode of that season is plain news.
  const ep9 = ep(2, 9, "2026-11-13");
  const next = whatsNew(show([...before.videos, ...season2, ep9]), after, local(2026, 11, 13, 8), ALL);
  expect(next.news?.kind).toBe("episodes");
  expect(newsBody(next.news!)).toBe("S2 E9 is out");
});

test("with new seasons off, a new season is still new episodes; with both off, nothing piles up", () => {
  const before = show([ep(1, 1, "2026-01-01")]);
  const memory = firstLook(before, local(2026, 2, 1));
  const s2 = show([...before.videos, ep(2, 1, "2026-11-06")]);
  expect(whatsNew(s2, memory, local(2026, 11, 7), { episodes: true, seasons: false }).news?.kind).toBe("episodes");
  expect(whatsNew(s2, memory, local(2026, 11, 7), { episodes: false, seasons: true }).news?.kind).toBe("season");
  const off = whatsNew(s2, memory, local(2026, 11, 7), { episodes: false, seasons: false });
  expect(off.news).toBeUndefined();
  // Turned on again later: the episode that came out while it was off isn't announced then.
  expect(whatsNew(s2, off.memory, local(2026, 11, 8), ALL).news).toBeUndefined();
});

test("nothing repeats after a restart: the memory survives a round trip through storage", () => {
  const before = show([ep(1, 1, "2026-11-01")]);
  const memory = firstLook(before, local(2026, 11, 2));
  const next = show([...before.videos, ep(1, 2, "2026-11-07")]);
  const first = whatsNew(next, memory, local(2026, 11, 7, 9), ALL);
  expect(first.news).toBeDefined();
  const restored = JSON.parse(JSON.stringify(first.memory)) as ShowMemory;
  expect(whatsNew(next, restored, local(2026, 11, 7, 12), ALL).news).toBeUndefined();
  expect(whatsNew(next, restored, local(2026, 11, 9, 12), ALL).news).toBeUndefined();
});

test("one notice per show per day; what comes later that day waits until the next", () => {
  const before = show([ep(1, 1, "2026-11-01")]);
  const memory = firstLook(before, local(2026, 11, 2));
  const morning = show([...before.videos, ep(1, 2, "2026-11-07")]);
  const first = whatsNew(morning, memory, local(2026, 11, 7, 9), ALL);
  expect(first.memory.notifiedDay).toBe(localDay(local(2026, 11, 7, 9)));
  const evening = show([...morning.videos, ep(1, 3, "2026-11-07T18:00:00.000Z")]);
  const now = Math.max(local(2026, 11, 7, 23), Date.UTC(2026, 10, 7, 18));
  if (localDay(now) === "2026-11-07") {
    const same = whatsNew(evening, first.memory, now, ALL);
    expect(same.news).toBeUndefined();
    expect(same.memory.known).not.toContain(ep(1, 3).id);
  }
  const tomorrow = whatsNew(evening, first.memory, local(2026, 11, 8, 9), ALL);
  expect(tomorrow.news?.videos.map((v) => v.episode)).toEqual([3]);
});

test("episodes listed late with old dates are remembered quietly", () => {
  const memory = firstLook(show([ep(1, 2, "2026-01-08")]), local(2026, 6, 1));
  // A listing that gained its missing first episode, dated back in January.
  const fixed = show([ep(1, 1, "2026-01-01"), ep(1, 2, "2026-01-08")]);
  const { news, memory: after } = whatsNew(fixed, memory, local(2026, 11, 7), ALL);
  expect(news).toBeUndefined();
  expect(after.known).toContain(ep(1, 1).id);
});

test("several episodes since the last check are one notice", () => {
  const before = show([ep(1, 1, "2026-10-01")]);
  const memory = firstLook(before, local(2026, 10, 2));
  const later = show([...before.videos, ep(1, 2, "2026-10-08"), ep(1, 3, "2026-10-15"), ep(1, 4, "2026-12-01")]);
  const { news } = whatsNew(later, memory, local(2026, 11, 7), ALL);
  expect(newsBody(news!)).toBe("2 new episodes: S1 E2–E3");
});

test("notes: one per show, a single one when many shows have news, clicks open the title", () => {
  const news = (i: number) => ({
    kind: "episodes" as const,
    show: { ...show([ep(1, 1, "2026-11-07")]), id: `tt000000${i}`, name: `Show ${i}` },
    videos: [{ ...ep(1, 1, "2026-11-07"), title: "The Fog" }],
  });
  const three = newsNotes([news(1), news(2), news(3)]);
  expect(three).toHaveLength(3);
  expect(three[0]).toEqual({ id: "news:tt0000001", title: "Show 1", body: "S1 E1 · The Fog is out", route: { name: "detail", type: "series", id: "tt0000001" } });
  const many = newsNotes([1, 2, 3, 4, 5].map(news));
  expect(many).toHaveLength(1);
  expect(many[0].title).toBe("New episodes of 5 shows");
  expect(many[0].body).toBe("Show 1, Show 2 and 3 more");
});

test("downloads: a finished or failed one is a note once, nothing for ones never seen moving", () => {
  const d = (id: string, state: Download["state"], extra: Partial<Download> = {}): Download => ({
    id,
    metaId: "tt0000002",
    type: "movie",
    name: "Night of the Comet Lantern",
    quality: "1080p",
    file: "film.mkv",
    received: 1,
    state,
    addedAt: 0,
    ...extra,
  });
  const before = [d("a", "downloading"), d("b", "downloading", { type: "series", season: 1, episode: 3, metaId: "tt0000001" }), d("c", "done")];
  const after = [d("a", "done"), d("b", "failed", { type: "series", season: 1, episode: 3, metaId: "tt0000001" }), d("c", "done"), d("e", "done")];
  const notes = downloadNotes(before, after);
  expect(notes.map((n) => [n.title, n.body])).toEqual([
    ["Download finished", "Night of the Comet Lantern"],
    ["Download failed", "Night of the Comet Lantern · S1 E3"],
  ]);
  expect(notes[0].route).toEqual({ name: "detail", type: "movie", id: "tt0000002" });
  expect(notes[1].route).toEqual({ name: "library-collection", view: "downloads" });
  expect(downloadNotes(after, after)).toEqual([]);
});

// --- The check itself, with stand-ins for the library, the metadata and the system.


const forget = () => ["p1", "p2"].forEach((p) => localStorage.removeItem(`polar.notifications.${p}`));

function harness(videos: () => Video[], planning = false) {
  const shown: { title: string; body: string; payload: string }[] = [];
  let planned: { id: string; at: number }[] = [];
  const deps: CheckDeps = {
    library: async () => [{ id: "tt0000001", type: "series", name: "The Lighthouse Keepers", addedAt: 1 }],
    started: async () => [],
    meta: async (type, id) => ({ id, type, name: "The Lighthouse Keepers", videos: videos() }) as Meta,
    show: async (n) => void shown.push(n),
    plan: planning ? async (n) => void (planned = n) : null,
  };
  return { deps, shown, planned: () => planned };
}

const ON = { episodes: true, seasons: true, scope: "library" as const };

test("check: first run remembers, the next episode is one note that opens the show, a restart repeats nothing", async () => {
  forget();
  let videos = [ep(1, 1, "2026-11-01")];
  const h = harness(() => videos);
  await runCheck("p1", ON, h.deps, local(2026, 11, 2));
  expect(h.shown).toEqual([]);
  videos = [...videos, ep(1, 2, "2026-11-08")];
  await runCheck("p1", ON, h.deps, local(2026, 11, 8, 10));
  expect(h.shown).toHaveLength(1);
  expect(h.shown[0].title).toBe("The Lighthouse Keepers");
  expect(payloadRoute(h.shown[0].payload)).toEqual({ name: "detail", type: "series", id: "tt0000001" });
  await runCheck("p1", ON, h.deps, local(2026, 11, 8, 13));
  await runCheck("p1", ON, h.deps, local(2026, 11, 9, 13));
  expect(h.shown).toHaveLength(1);
  // Another profile on the device has its own memory.
  expect(Object.keys(loadMemory("p2").shows)).toEqual([]);
});

test("check: everything off forgets, so turning it on again doesn't bring a backlog", async () => {
  forget();
  let videos = [ep(1, 1, "2026-11-01")];
  const h = harness(() => videos);
  await runCheck("p1", ON, h.deps, local(2026, 11, 2));
  await runCheck("p1", { ...ON, episodes: false, seasons: false }, h.deps, local(2026, 11, 3));
  videos = [...videos, ep(1, 2, "2026-11-05")];
  await runCheck("p1", ON, h.deps, local(2026, 11, 6));
  expect(h.shown).toEqual([]);
});

test("check: a show that can't be looked up keeps its memory", async () => {
  forget();
  let fail = false;
  let videos = [ep(1, 1, "2026-11-01")];
  const h = harness(() => {
    if (fail) throw new Error("offline");
    return videos;
  });
  await runCheck("p1", ON, h.deps, local(2026, 11, 2));
  fail = true;
  await runCheck("p1", ON, h.deps, local(2026, 11, 3));
  expect(loadMemory("p1").shows.tt0000001?.known).toEqual([ep(1, 1).id]);
  fail = false;
  videos = [...videos, ep(1, 2, "2026-11-04")];
  await runCheck("p1", ON, h.deps, local(2026, 11, 4, 9));
  expect(h.shown).toHaveLength(1);
});

test("check on phones: listed episodes are planned ahead, and once their time passes they count as said", async () => {
  forget();
  const videos = [ep(1, 1, "2026-11-01"), ep(1, 2, "2026-11-08"), ep(1, 3, "2026-11-15"), ep(1, 4, "2026-12-30")];
  const h = harness(() => videos, true);
  const due = await runCheck("p1", ON, h.deps, local(2026, 11, 2));
  expect(h.planned().map((n) => n.at)).toEqual([local(2026, 11, 8), local(2026, 11, 15)]);
  expect(due).toBe(local(2026, 11, 8));
  // The app opens again after the first planned note went out: nothing said twice.
  await runCheck("p1", ON, h.deps, local(2026, 11, 9, 12));
  expect(h.shown).toEqual([]);
  expect(h.planned().map((n) => n.at)).toEqual([local(2026, 11, 15)]);
});

test("followed: started shows first, the library too unless only started ones are wanted", () => {
  const lib = [
    { id: "tt0000003", type: "series" as const, name: "c", addedAt: 3 },
    { id: "tt0000009", type: "movie" as const, name: "m", addedAt: 9 },
  ];
  const started = [{ metaId: "tt0000004", videoId: "x", type: "series" as const, name: "d", position: 1, duration: 2, updatedAt: 5 }];
  expect(followed(lib, started, "library")).toEqual(["tt0000004", "tt0000003"]);
  expect(followed(lib, started, "started")).toEqual(["tt0000004"]);
});

test("a click's payload opens only the screens notes open", () => {
  expect(payloadRoute(routePayload({ name: "detail", type: "series", id: "kitsu:12" }))).toEqual({ name: "detail", type: "series", id: "kitsu:12" });
  expect(payloadRoute(routePayload({ name: "library" }))).toEqual({ name: "library" });
  expect(payloadRoute('{"name":"player","type":"movie","metaId":"tt0000001","videoId":"tt0000001","stream":{"url":"https://media.example.com/film.mkv"}}')).toBeUndefined();
  expect(payloadRoute('{"name":"settings","page":"account"}')).toBeUndefined();
  expect(payloadRoute('{"name":"detail","type":"series","id":"../../x y"}')).toBeUndefined();
  expect(payloadRoute('{"name":"detail","type":"book","id":"tt0000001"}')).toBeUndefined();
  expect(payloadRoute("not json")).toBeUndefined();
});

test("a stored memory that's damaged reads as empty or partial, never throws", () => {
  expect(readMemory("x")).toEqual({ shows: {}, planned: {} });
  expect(readMemory({ shows: { a: { known: ["1", 2], seasons: [1, "2", 1.5], since: 5 }, b: { known: [] } } }).shows).toEqual({
    a: { known: ["1"], seasons: [1], since: 5 },
  });
});
