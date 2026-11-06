// The watch-party harness (#203): a few members on ChaosHub (tests/partyChaos.ts),
// each a real room and player follower, through delays, dropped and reordered
// messages, connections that drop or die silently, a slow first load and a host
// that leaves. Every seed is a different run; each must end with every device
// agreeing: the same members, nobody shown disconnected, the same timeline and
// host, nobody stuck loading or knocking, the players together, and no channel
// closed for too many presence updates. And while it
// runs, a member that's connected is never shown as disconnected for long.
//
// PARTY_SEEDS=n runs more seeds; a failing seed prints its own replay command
// and every member's party log.
import { expect, test } from "bun:test";
import { CALM, ChaosHub, rng, type Faults } from "./partyChaos";
import { MEDIA, setup, statusOf, type Member } from "./partySim";

/** A connected member may look disconnected to another for at most this long. */
const SHOWN_LOST_MAX = 8000;
/** After the faults stop, everyone agrees within this long (a leftover entry of someone gone takes GHOST_MS + GONE_MS). */
const SETTLE_MS = 40_000;

interface Run {
  ok: boolean;
  problems: string[];
  report: string;
}

function runSeed(seed: number, opts: { members?: number; chaosMs?: number; faults?: Faults; hostLeaves?: boolean } = {}): Run {
  const random = rng(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  const s = setup((sim) => new ChaosHub(sim, random));
  const { sim, hub } = s;
  const count = opts.members ?? 2 + Math.floor(random() * 3);
  const members: Member[] = [];
  /** Each member's id in the party now (a retried join has a new one). */
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    members.push(s.member(20 + Math.floor(random() * 250), { freshIds: true }));
    ids.push(`member-${i + 1}`);
  }
  /** Members still in the party (not left), and since when each has had no connection fault. */
  const inParty = new Set<number>();
  const calmSince = new Map<string, number>();
  const problems: string[] = [];
  const faults = opts.faults ?? { jitter: 50 + random() * 450, drop: random() * 0.1, split: random() * 0.5, miss: random() * 0.05 };
  const engine = () => ({ skew: 1 + (random() - 0.5) * 0.01, engineLag: 40 + random() * 150, seekMs: 200 + random() * 1200 });

  // The host opens the party on what it's watching; the others join a little apart, each with a slow or quick first load.
  hub.faults = faults;
  const host = members[0];
  const mh = s.watch(host, 100, engine());
  sim.run(2000);
  host.room.startParty(MEDIA, mh.currentTime, false, { name: "Ash", avatar: "" });
  inParty.add(0);
  calmSince.set(ids[0], sim.now());
  const code = host.room.getParty()!.code;
  /** Members to open the player for once they're in the room, with how long its load takes. */
  const opening = new Map<number, number>();
  /** Joins that failed (connection trouble the whole time): the viewer tries again, as a person would. */
  let retries = 0;
  const opener = sim.every(() => {
    for (const i of inParty) {
      const m = members[i];
      if (i === 0 || m.room.getParty() || m.room.getExit()) continue;
      retries++;
      m.room.joinParty(code, { name: `Guest ${i}`, avatar: "" }).catch(() => {});
      ids[i] = m.room.getParty()!.me;
      calmSince.set(ids[i], sim.now());
      if (!opening.has(i)) opening.set(i, 500 + random() * 3000);
    }
    for (const [i, loadMs] of opening) {
      const m = members[i];
      const p = m.room.getParty();
      if (!p?.playback || p.knocking) continue;
      opening.delete(i);
      s.watch(m, m.room.partyPosition(MEDIA.videoId) ?? 0, engine(), loadMs);
    }
  }, 100);
  for (let i = 1; i < count; i++) {
    sim.run(200 + random() * 3000);
    const m = members[i];
    m.room.joinParty(code, { name: `Guest ${i}`, avatar: "" }).catch(() => {});
    // The whole run is synchronous, so the join's promise never settles in it: the player opens once the room is joined.
    opening.set(i, 500 + random() * 9000);
    inParty.add(i);
    calmSince.set(ids[i], sim.now());
  }

  // Shown disconnected while connected: watched every 250 ms for every pair.
  const lostSince = new Map<string, number>();
  let worstLost = { ms: 0, who: "" };
  const watch = sim.every(() => {
    for (const i of inParty)
      for (const j of inParty) {
        if (i === j) continue;
        const key = `${ids[i]} sees ${ids[j]}`;
        const p = members[i].room.getParty();
        const calm = [ids[i], ids[j]].every((id) => hub.connected(id) && sim.now() - (calmSince.get(id) ?? Infinity) > 0);
        const them = p?.members.find((m) => m.id === ids[j]);
        const shownOff = !!p && !p.knocking && !members[j].room.getParty()?.knocking && (!them || them.lost);
        if (!calm || !shownOff) {
          lostSince.delete(key);
          continue;
        }
        const since = lostSince.get(key) ?? sim.now();
        lostSince.set(key, since);
        if (sim.now() - since > worstLost.ms) worstLost = { ms: sim.now() - since, who: key };
      }
  }, 250);

  // The chaos: actions and faults at random for a minute or so.
  const chaosEnd = sim.now() + (opts.chaosMs ?? 45_000 + random() * 30_000);
  let hostLeft = false;
  const inRoom = (i: number) => {
    const p = members[i].room.getParty();
    return !!p?.playback && !p.knocking;
  };
  /** When the last fault is over, connections back and the server caught up: the settling starts from there. */
  let faultsUntil = 0;
  const fault = (id: string, ms: number) => {
    calmSince.set(id, Infinity);
    faultsUntil = Math.max(faultsUntil, sim.now() + ms);
    sim.after(() => calmSince.set(id, sim.now()), ms);
  };
  for (;;) {
    sim.run(500 + random() * 4000);
    if (sim.now() >= chaosEnd) break;
    const live = [...inParty];
    const i = pick(live);
    const m = members[i];
    const id = ids[i];
    const r = random();
    if (r < 0.35 && m.media) {
      // Someone plays, pauses or seeks.
      const a = random();
      if (a < 0.4) m.media.pause();
      else if (a < 0.8) void m.media.play();
      else if (a < 0.9) m.media.currentTime = Math.max(0, m.media.currentTime + (random() - 0.4) * 300);
      // A small step (arrow keys, a nudge of the scrubber): paused, it's still the room's (#236).
      else m.media.currentTime = Math.max(0, m.media.currentTime + (random() - 0.5) * 6);
    } else if (r < 0.5) {
      const back = 500 + random() * 8000;
      const notice = 1000 + random() * 20_000;
      fault(id, Math.max(back + 3000, notice));
      hub.drop(id, back, notice);
    } else if (r < 0.58) {
      const notice = 5000 + random() * 25_000;
      const server = 2000 + random() * 30_000;
      fault(id, Math.max(notice + 4000, server));
      hub.silent(id, notice, server);
    } else if (r < 0.66) {
      fault(id, 4000);
      hub.lose(id);
    } else if (r < 0.74 && m.stop && m.media) {
      // Out to browse, and back a little later.
      m.stop();
      m.stop = undefined;
      sim.after(() => inParty.has(i) && opening.set(i, 500 + random() * 3000), 1000 + random() * 6000);
    } else if (r < 0.8 && (opts.hostLeaves ?? true) && !hostLeft && i === 0 && live.filter((j) => j !== 0 && inRoom(j)).length >= 2) {
      // Leaves only a room that carries on: two others in it with its timeline.
      hostLeft = true;
      m.stop?.();
      m.room.leaveParty();
      inParty.delete(0);
    }
  }

  // The faults stop; give everyone time to agree.
  hub.faults = { ...CALM, jitter: 30 };
  sim.run(Math.max(0, faultsUntil - sim.now()) + SETTLE_MS);
  watch();
  opener();

  const live = [...inParty];
  const parties = live.map((i) => members[i].room.getParty());
  const name = (k: number) => ids[live[k]];
  parties.forEach((p, k) => {
    if (!p) return problems.push(`${name(k)} is out of the party${members[live[k]].room.getExit() ? `: ${members[live[k]].room.getExit()!.text}` : ""}`);
    if (p.status !== "live") problems.push(`${name(k)} is ${p.status}`);
    if (p.knocking) problems.push(`${name(k)} is still knocking`);
    if (!p.playback) problems.push(`${name(k)} has no timeline`);
  });
  const want = live.map((i) => ids[i]).sort();
  parties.forEach((p, k) => {
    if (!p) return;
    const seen = p.members.map((m) => m.id).sort();
    if (seen.join() !== want.join()) problems.push(`${name(k)} sees ${seen.join(" ")}, not ${want.join(" ")}`);
    for (const m of p.members) if (m.lost) problems.push(`${name(k)} shows ${m.id} disconnected`);
    for (const j of live) {
      const media = members[j].media;
      if (media?.started && members[j].stop && statusOf(p, ids[j]) === "Loading") problems.push(`${name(k)} shows ${ids[j]} loading, but it's playing`);
    }
  });
  const first = parties[0];
  parties.forEach((p, k) => {
    if (!p || !first || k === 0) return;
    if (p.hostId !== first.hostId) problems.push(`${name(k)} has host ${p.hostId}, ${name(0)} has ${first.hostId}`);
    const [a, b] = [first.playback, p.playback];
    if (a && b && (a.v !== b.v || a.by !== b.by || a.paused !== b.paused || a.held !== b.held))
      problems.push(
        `${name(k)} is on v${b.v} by ${b.by} (paused ${b.paused}, held ${b.held}), ${name(0)} on v${a.v} by ${a.by} (paused ${a.paused}, held ${a.held})`,
      );
    if (p.rules.v !== first.rules.v) problems.push(`${name(k)} has rules v${p.rules.v}, ${name(0)} v${first.rules.v}`);
  });
  const players = live.map((i) => members[i]).filter((m) => m.stop && m.media?.started);
  for (const m of players.slice(1)) {
    const gap = Math.abs(m.media!.currentTime - players[0].media!.currentTime);
    // Paused, each player is within half a second of the room's frame (a pause lands where each engine was): a small seek
    // left behind shows here (#236). Playing, the follower's band.
    const paused = first?.playback?.paused && !m.media!.buffering;
    if (gap > (paused ? 1 : 1.5)) problems.push(`players ${gap.toFixed(1)} s apart${paused ? " while paused" : ""}`);
  }
  // Supabase's presence limit (#227): over it, a member's channel is closed and it hears nothing until it reconnects.
  if (hub.closedByServer) problems.push(`the server closed a channel for too many presence updates ${hub.closedByServer} times`);
  if (worstLost.ms > SHOWN_LOST_MAX) problems.push(`${worstLost.who} as disconnected for ${(worstLost.ms / 1000).toFixed(1)} s while both were connected`);

  const report = [
    `seed ${seed} (ended at ${sim.now()} ms): ${count} members, faults ${JSON.stringify(faults)}${hostLeft ? ", host left" : ""}${retries ? `, ${retries} join retries` : ""}`,
    ...problems.map((p) => `  - ${p}`),
    `replay: PARTY_SEED=${seed} bun test tests/partyChaos.test.ts`,
    ...members.flatMap((m, i) => [``, `===== ${ids[i]} =====`, m.room.partyLog()]),
    ``,
    `===== server =====`,
    ...hub.trace,
  ].join("\n");
  return { ok: problems.length === 0, problems, report };
}

const one = Number(process.env.PARTY_SEED);
const seeds = Number.isFinite(one) && process.env.PARTY_SEED ? [one] : Array.from({ length: Number(process.env.PARTY_SEEDS) || 60 }, (_, i) => i + 1);

test(`the party agrees after chaos, ${seeds.length} seeded runs`, () => {
  const failed: Run[] = [];
  for (const seed of seeds) {
    const r = runSeed(seed);
    if (!r.ok) failed.push(r);
  }
  if (failed.length) {
    // The first failure in full; the rest by their problems.
    console.log(failed[0].report);
    for (const f of failed.slice(1))
      console.log(
        f.report
          .split("\n")
          .slice(0, 1 + f.problems.length)
          .join("\n"),
      );
  }
  expect(failed.map((f) => f.report.split("\n")[0])).toEqual([]);
}, 120_000);
