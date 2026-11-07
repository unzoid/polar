import { storeLocal } from "../errors";
import { contentType, isRecord, listOf, num, str, strings } from "../parse";
import type { Route } from "../router";
import type { ShowMemory } from "./whatsNew";

/**
 * What the checks remember, per profile, on this device only (#209): the episodes each show had
 * out, when it was last announced, and on phones what was handed to the system to say later. No
 * account needed, nothing synced.
 */

export interface PlannedMemory {
  at: number;
  memory: ShowMemory;
}

export interface Memory {
  shows: Record<string, ShowMemory>;
  /** Phones: per show, the memory as it will be after each planned note (whatsNew.ts `upcoming`). */
  planned: Record<string, PlannedMemory[]>;
}

const key = (profile: string) => `polar.notifications.${profile}`;

function readShow(v: unknown): ShowMemory | undefined {
  if (!isRecord(v)) return undefined;
  const since = num(v.since);
  if (since == null) return undefined;
  const day = str(v.notifiedDay);
  return {
    known: strings(v.known),
    seasons: listOf(v.seasons, (s) => (num(s) != null && Number.isInteger(s) ? (s as number) : undefined)),
    since,
    ...(day ? { notifiedDay: day } : {}),
  };
}

const readPlanned = (v: unknown): PlannedMemory | undefined => {
  if (!isRecord(v)) return undefined;
  const at = num(v.at);
  const memory = readShow(v.memory);
  return at != null && memory ? { at, memory } : undefined;
};

export function readMemory(v: unknown): Memory {
  const out: Memory = { shows: {}, planned: {} };
  if (!isRecord(v)) return out;
  if (isRecord(v.shows)) {
    for (const [id, m] of Object.entries(v.shows)) {
      const show = readShow(m);
      if (show) out.shows[id] = show;
    }
  }
  if (isRecord(v.planned)) {
    for (const [id, list] of Object.entries(v.planned)) {
      const plans = listOf(list, readPlanned);
      if (plans.length) out.planned[id] = plans;
    }
  }
  return out;
}

export function loadMemory(profile: string, storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Memory {
  try {
    const raw = storage?.getItem(key(profile));
    return readMemory(raw == null ? undefined : JSON.parse(raw));
  } catch {
    return readMemory(undefined);
  }
}

export const saveMemory = (profile: string, memory: Memory, storage?: Pick<Storage, "setItem">) =>
  storeLocal(key(profile), JSON.stringify(memory), storage ?? globalThis.localStorage);

/** A click's payload: the screen to open. */
export const routePayload = (route: Route) => JSON.stringify(route);

const ID = /^[\w:.-]{1,80}$/;

/**
 * The screen a click asks for, or nothing. A payload can come from outside the app (another program
 * can start it with one on some systems), so only the few screens notes open are accepted, and only
 * with ids of the shape Polarity's own have.
 */
export function payloadRoute(payload: string): Route | undefined {
  let v: unknown;
  try {
    v = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (!isRecord(v)) return undefined;
  if (v.name === "library") return { name: "library" };
  if (v.name === "library-collection" && v.view === "downloads") return { name: "library-collection", view: "downloads" };
  if (v.name === "detail") {
    const type = contentType(v.type);
    const id = str(v.id);
    if (type && id && ID.test(id)) return { name: "detail", type, id };
  }
  return undefined;
}
