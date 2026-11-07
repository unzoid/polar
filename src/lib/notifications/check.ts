import { concurrency } from "../net/limiter";
import type { NativeNote, PlannedNote } from "../platform/notifications";
import type { ContentType, LibraryItem, Meta, Progress } from "../types";
import { newsNotes, type Note } from "./messages";
import { loadMemory, routePayload, saveMemory, type Memory, type PlannedMemory } from "./store";
import { upcoming, whatsNew, type News, type Planned, type Wanted } from "./whatsNew";

/**
 * One check for new episodes and seasons (#209): the series the user follows, their episode lists
 * (the same metadata title pages load, through its cache), what's new since last time, notes for
 * it. Phones also hand the system what the listed air dates will bring in the next two weeks, so
 * those arrive with the app closed. useNotifications.ts runs it on launch and every few hours.
 */

export type Scope = "library" | "started";

export interface CheckOptions extends Wanted {
  scope: Scope;
}

export interface CheckDeps {
  library(): Promise<LibraryItem[]>;
  /** Continue Watching and history: what's been started. */
  started(): Promise<Progress[]>;
  meta(type: ContentType, id: string): Promise<Meta>;
  show(note: NativeNote): Promise<void>;
  /** Replaces what the system was told to say later; `null`: this platform doesn't plan (desktop). */
  plan: ((notes: PlannedNote[]) => Promise<void>) | null;
}

/** How far ahead phones plan. */
export const PLAN_DAYS = 14;
/** Shows looked at per check, most recent first: a big library shouldn't mean hundreds of lookups every few hours. */
export const MAX_SHOWS = 200;
const lookup = concurrency(4);
const DAY = 86_400_000;

/** The series to look at, most recently touched first. */
export function followed(library: readonly LibraryItem[], started: readonly Progress[], scope: Scope): string[] {
  const out = new Set<string>();
  for (const p of [...started].sort((a, b) => b.updatedAt - a.updatedAt)) if (p.type === "series") out.add(p.metaId);
  if (scope === "library") {
    for (const l of [...library].sort((a, b) => (b.updatedAt ?? b.addedAt) - (a.updatedAt ?? a.addedAt))) if (l.type === "series") out.add(l.id);
  }
  return [...out].slice(0, MAX_SHOWS);
}

const toNative = (n: Note): NativeNote => ({ id: n.id, title: n.title, body: n.body, payload: routePayload(n.route) });

/** Planned news grouped by moment, then made into notes the way a check at that moment would. */
function plannedNotes(plans: { id: string; plan: Planned }[]): PlannedNote[] {
  const byAt = new Map<number, News[]>();
  for (const { plan } of plans) byAt.set(plan.at, [...(byAt.get(plan.at) ?? []), plan.news]);
  return [...byAt].flatMap(([at, news]) => newsNotes(news).map((n) => ({ ...toNative(n), id: `${n.id}@${at}`, at })));
}

/** The latest planned memory whose time has come: the system said it, so it counts as said. */
function caughtUp(memory: Memory, id: string, now: number) {
  const passed = (memory.planned[id] ?? []).filter((p) => p.at <= now);
  return passed.length ? passed[passed.length - 1].memory : memory.shows[id];
}

/**
 * Runs a check and keeps what it learnt. Resolves with when the next listed episode comes out (a
 * desktop checks again then), or undefined.
 */
export async function runCheck(profile: string, options: CheckOptions, deps: CheckDeps, now = Date.now()): Promise<number | undefined> {
  const memory = loadMemory(profile);
  if (!options.episodes && !options.seasons) {
    // Off: forget, so turning it on again starts afresh instead of announcing what came out meanwhile.
    saveMemory(profile, { shows: {}, planned: {} });
    await deps.plan?.([]);
    return undefined;
  }
  const [library, started] = await Promise.all([deps.library(), deps.started()]);
  const ids = followed(library, started, options.scope);
  const typeOf = (id: string) => (library.find((l) => l.id === id)?.type ?? started.find((p) => p.metaId === id)?.type ?? "series") as ContentType;

  const shows = await Promise.all(ids.map((id) => lookup(() => deps.meta(typeOf(id), id)).catch(() => undefined)));
  const next: Memory = { shows: {}, planned: {} };
  const news: News[] = [];
  const plans: { id: string; plan: Planned }[] = [];
  ids.forEach((id, i) => {
    const meta = shows[i];
    const before = caughtUp(memory, id, now);
    if (!meta || meta.type !== "series") {
      // Not reachable this time: keep what was known.
      if (before) next.shows[id] = before;
      return;
    }
    const show = { id, type: meta.type, name: meta.name, videos: meta.videos };
    const r = whatsNew(show, before, now, options);
    if (r.news) news.push(r.news);
    next.shows[id] = r.memory;
    const ahead = upcoming(show, r.memory, now, now + PLAN_DAYS * DAY, options);
    plans.push(...ahead.map((plan) => ({ id, plan })));
    if (deps.plan && ahead.length) next.planned[id] = ahead.map((p): PlannedMemory => ({ at: p.at, memory: p.memory }));
  });

  // Remember first: a note that fails to show isn't worth announcing twice.
  saveMemory(profile, next);
  for (const note of newsNotes(news)) await deps.show(toNative(note)).catch(() => undefined);
  await deps.plan?.(plannedNotes(plans)).catch(() => undefined);
  const soonest = plans.reduce<number | undefined>((t, p) => (t == null || p.plan.at < t ? p.plan.at : t), undefined);
  return soonest;
}
