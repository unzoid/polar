// What the party harness (tests/partyChaos.test.ts) found, each kept as a
// scripted case on the same fault-injecting server (tests/partyChaos.ts), so a
// fix that comes undone fails here by name, whatever the random runs do.
import { expect, test } from "bun:test";
import { ECHO_MISSES, GHOST_MS, GONE_MS, HEAL_MS, PING_MS } from "../src/lib/party/room";
import { ChaosHub, rng } from "./partyChaos";
import { MEDIA, setup, statusOf, type Member } from "./partySim";

const id = (i: number) => `member-${i + 1}`;

/** A party of `n` on the calm server: the first opens it, the others join and open the player. */
function party(n: number) {
  const s = setup((sim) => new ChaosHub(sim, rng(1)));
  const ms: Member[] = Array.from({ length: n }, () => s.member());
  const first = s.watch(ms[0], 100);
  s.sim.run(2000);
  ms[0].room.startParty(MEDIA, first.currentTime, false, { name: "Ash", avatar: "" });
  s.sim.run(1000);
  const code = ms[0].room.getParty()!.code;
  for (const m of ms.slice(1)) {
    m.room.joinParty(code, { name: "Guest", avatar: "" }).catch(() => {});
    s.sim.run(1500);
    expect(m.room.getParty()?.playback).toBeTruthy();
    s.watch(m, m.room.partyPosition(MEDIA.videoId)!);
  }
  s.sim.run(5000);
  return { ...s, ms };
}

const timeline = (m: Member) => {
  const p = m.room.getParty()?.playback;
  return p && { v: p.v, by: p.by, paused: p.paused };
};

test("an action the host missed still reaches it when the host's heartbeat carries someone else's timeline", () => {
  const { sim, hub, ms } = party(3);
  // B seeks: the room's timeline is now B's, and the host re-sends it on its heartbeat.
  ms[1].media!.currentTime = ms[1].media!.currentTime + 60;
  sim.run(3000);
  // C pauses, and nobody hears it.
  hub.lost.add(`${id(2)}>*`);
  ms[2].media!.pause();
  sim.run(500);
  hub.lost.clear();
  sim.run(12_000);
  for (const m of ms) expect(timeline(m)).toEqual(timeline(ms[2]));
  expect(ms.every((m) => m.media!.paused)).toBe(true);
});

test("a member who missed an action takes it from the host after its author has left", () => {
  const { sim, hub, ms } = party(3);
  // B pauses, C doesn't hear it, then B leaves without C hearing that either.
  hub.lost.add(`${id(1)}>${id(2)}`);
  ms[1].media!.pause();
  sim.run(1000);
  ms[1].stop!();
  ms[1].room.leaveParty();
  sim.run(1000);
  hub.lost.clear();
  sim.run(12_000);
  expect(timeline(ms[2])).toEqual(timeline(ms[0]));
  expect(ms[2].media!.paused).toBe(true);
});

test("a member can't pass off its own timeline as a member's who's still here", () => {
  const { sim, hub, ms } = party(3);
  const before = timeline(ms[0])!;
  const p = ms[0].room.getParty()!.playback!;
  // C says the host paused. The host is right here and said no such thing.
  hub.inject(id(2), { t: "state", from: id(2), tl: { v: p.v + 1, by: id(0), media: p.media, paused: true, held: false, position: 10, lag: 0 } });
  sim.run(2000);
  expect(timeline(ms[0])).toEqual(before);
  expect(timeline(ms[1])).toEqual(before);
});

test("a joiner whose connection drops while it waits to be let in still gets in", () => {
  const s = setup((sim) => new ChaosHub(sim, rng(1)));
  const [a, b] = [s.member(), s.member()];
  s.watch(a, 100);
  s.sim.run(2000);
  a.room.startParty(MEDIA, 100, false, { name: "Ash", avatar: "" });
  s.sim.run(1000);
  let result = "";
  b.room.joinParty(a.room.getParty()!.code, { name: "Bea", avatar: "" }).then(
    () => (result = "joined"),
    (e: Error) => (result = e.message),
  );
  s.sim.run(300);
  s.hub.drop(id(1), 4000, 1000);
  s.sim.run(10_000);
  expect(b.room.getParty()?.knocking).toBe(false);
  expect(b.room.getParty()?.playback).toBeTruthy();
  return Promise.resolve().then(() => expect(result).toBe("joined"));
});

test("a member who said bye stays gone, even if a presence list still has it", () => {
  const { sim, hub, ms } = party(3);
  // A misses the presence change for B's leaving; B's bye reaches it.
  hub.missPresence.add(id(0));
  const seen: string[][] = [];
  const watch = sim.every(() => seen.push(ms[0].room.getParty()!.members.map((m) => m.id)), 100);
  ms[1].stop!();
  ms[1].room.leaveParty();
  sim.run(500);
  hub.missPresence.clear();
  // Something else changes presence: A's copy still lists B.
  ms[2].room.setPartyBuffering(true);
  sim.run(GHOST_MS);
  watch();
  const after = seen.slice(seen.findIndex((list) => !list.includes(id(1))));
  expect(after.length).toBeGreaterThan(0);
  expect(after.some((list) => list.includes(id(1)))).toBe(false);
  expect(ms[0].room.getParty()!.hostId).toBe(id(0));
});

test("a new host that never got the room's rules still ends up with the same rules as everyone", () => {
  const { sim, hub, ms } = party(3);
  // The host changes a rule; B doesn't hear it, nor the host leaving.
  hub.lost.add(`${id(0)}>${id(1)}`);
  ms[0].room.setRules({ wait: false });
  sim.run(1000);
  ms[0].stop!();
  ms[0].room.leaveParty();
  sim.run(1000);
  hub.lost.clear();
  sim.run(15_000);
  const [b, c] = [ms[1].room.getParty()!, ms[2].room.getParty()!];
  expect(b.hostId).toBe(id(1));
  expect(c.hostId).toBe(id(1));
  expect(c.rules).toEqual(b.rules);
});

test("a status update one member missed is noticed from the pings and sent again", () => {
  const { sim, hub, ms } = party(2);
  const [a, b] = ms;
  // B leaves the player; A misses the presence change, so it still has B watching.
  hub.missPresence.add(id(0));
  b.stop!();
  sim.run(500);
  hub.missPresence.clear();
  expect(statusOf(a.room.getParty()!, id(1))).toBe("Watching");
  sim.run(5000 + HEAL_MS + 1000);
  expect(statusOf(a.room.getParty()!, id(1))).toBe("Away");
});

test("a member missing from one device's presence but still talking is shown as connected, and its entry comes back", () => {
  const { sim, hub, ms } = party(2);
  const [a] = ms;
  const shown: string[] = [];
  const watch = sim.every(() => shown.push(statusOf(a.room.getParty()!, id(1))), 100);
  // The server drops B's entry; B sends it again, and A misses that: its copy has no B, while B talks on.
  hub.lose(id(1));
  sim.run(500);
  expect(a.room.getParty()!.members.find((m) => m.id === id(1))).toBeTruthy(); // missing, but just heard from
  hub.missPresence.add(id(0));
  sim.run(HEAL_MS * 2);
  hub.missPresence.clear();
  sim.run(10_000);
  watch();
  expect(shown).not.toContain("Disconnected");
  expect(shown).not.toContain("gone");
  // Asked for, B's entry came back into A's copy of presence.
  expect(a.room.partyLog()).toContain(`${id(1)} back in presence`);
});

test("a member whose leaving nobody heard of is taken as gone once it's been silent long enough", () => {
  const { sim, hub, ms } = party(3);
  // C goes; B hears neither its bye nor its leaving presence.
  hub.lost.add(`${id(2)}>${id(1)}`);
  hub.missPresence.add(id(1));
  ms[2].stop!();
  ms[2].room.leaveParty();
  sim.run(1000);
  hub.missPresence.clear();
  hub.lost.clear();
  expect(ms[1].room.getParty()!.members.map((m) => m.id)).toContain(id(2));
  sim.run(GHOST_MS + GONE_MS + 3000);
  expect(ms[1].room.getParty()!.members.map((m) => m.id)).not.toContain(id(2));
});

test("a connection that dies without a word is noticed from the pings and opened again", () => {
  const { sim, hub, ms } = party(2);
  const [a, b] = ms;
  // The library won't notice for minutes; the server drops B after ten seconds.
  hub.silent(id(1), 300_000, 10_000);
  sim.run(PING_MS * (ECHO_MISSES + 1) + 10_000);
  expect(b.room.getParty()!.status).toBe("live");
  expect(hub.connected(id(1))).toBe(true);
  expect(statusOf(a.room.getParty()!, id(1))).toBe("Watching");
  // And it hears the room again: A pauses, B follows.
  a.media!.pause();
  sim.run(3000);
  expect(timeline(b)).toEqual(timeline(a));
});

test("a member let in without the timeline (the answers were lost) asks again instead of waiting for the heartbeat", () => {
  const s = setup((sim) => new ChaosHub(sim, rng(1)));
  const [a, b] = [s.member(), s.member()];
  s.watch(a, 100);
  s.sim.run(2000);
  a.room.startParty(MEDIA, 100, false, { name: "Ash", avatar: "" });
  s.sim.run(3000);
  // The host's timeline doesn't reach B for a while; its rules and admit do.
  s.hub.lost.add(`${id(0)}>${id(1)}:state`);
  b.room.joinParty(a.room.getParty()!.code, { name: "Bea", avatar: "" }).catch(() => {});
  s.sim.run(1500);
  s.hub.lost.clear();
  expect(b.room.getParty()!.knocking).toBe(false);
  expect(b.room.getParty()!.playback).toBeNull();
  s.sim.run(HEAL_MS + 1000);
  expect(b.room.getParty()!.playback).toBeTruthy();
});
