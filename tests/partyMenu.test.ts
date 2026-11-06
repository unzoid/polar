// The party menu's actions (#156), on simulated members (tests/partySim.ts):
// each takes effect for every member within a couple of seconds.
import { expect, test } from "bun:test";
import { ENDED, KICKED } from "../src/lib/party/room";
import { MEDIA, partyOfTwo, statusOf, type Member } from "./partySim";

/** A third member joins A's party; its join's outcome is in `result`. */
function third(s: ReturnType<typeof partyOfTwo>) {
  const c: Member & { result?: string } = s.member();
  const code = s.a.room.getParty()!.code;
  c.room.joinParty(code, { name: "Cy", avatar: "" }).then(
    () => (c.result = "joined"),
    (e: Error) => (c.result = e.message),
  );
  return c;
}

/** Lets promise callbacks run: the simulated clock doesn't. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const ids = (m: Member) => m.room.getParty()?.members.map((x) => x.id) ?? null;

test("Remove: the member is out within two seconds, told why, and gone from everyone's list", async () => {
  const s = partyOfTwo();
  const c = third(s);
  s.sim.run(2000);
  await flush();
  expect(c.result).toBe("joined");
  s.sim.run(3000);
  s.a.room.kick("member-2");
  s.sim.run(2000);
  expect(s.b.room.getParty()).toBeNull();
  expect(s.b.room.getExit()?.text).toBe(KICKED);
  expect(ids(s.a)).toEqual(["member-1", "member-3"]);
  expect(ids(c)).toEqual(["member-1", "member-3"]);
  expect(c.room.getParty()!.notes.map((n) => n.text)).toContain("was removed by the host");
});

test("a removed member that stays connected is neither shown nor heard", async () => {
  const s = partyOfTwo();
  s.sim.run(3000);
  // B's app ignores the kick: still in presence, still sending.
  s.hub.dropMessages.add("member-1"); // B never hears the kick or the new rules
  s.a.room.kick("member-2");
  s.sim.run(200);
  s.hub.dropMessages.clear();
  // A stops listening to B at once; B still thinks it's in, and pauses.
  s.mb.pause();
  s.sim.run(1500);
  expect(ids(s.a)).toEqual(["member-1"]);
  expect(s.a.room.getParty()!.playback!.paused).toBe(false);
  // The host's next heartbeat carries the rules, and B learns it's out.
  s.sim.run(10_000);
  expect(s.b.room.getParty()).toBeNull();
  expect(s.b.room.getExit()?.text).toBe(KICKED);
});

test("Make host hands the role over for everyone; the old host can't change the rules any more", async () => {
  const s = partyOfTwo();
  s.sim.run(3000);
  s.a.room.makeHost("member-2");
  s.sim.run(2000);
  expect(s.a.room.getParty()!.hostId).toBe("member-2");
  expect(s.b.room.getParty()!.hostId).toBe("member-2");
  expect(s.a.room.getParty()!.notes.map((n) => n.text)).toContain("is now the host");
  s.a.room.setRules({ locked: true });
  s.sim.run(2000);
  expect(s.b.room.getParty()!.rules.locked).toBe(false);
  s.b.room.setRules({ locked: true });
  s.sim.run(2000);
  expect(s.a.room.getParty()!.rules.locked).toBe(true);
});

test("Lock: a new joiner is turned away and told why; unlocked, the code works again", async () => {
  const s = partyOfTwo();
  s.sim.run(3000);
  s.a.room.setRules({ locked: true });
  s.sim.run(1000);
  const c = third(s);
  s.sim.run(3000);
  await flush();
  expect(c.result).toBe("This watch party is locked. Ask the host to unlock it.");
  expect(c.room.getParty()).toBeNull();
  expect(ids(s.a)).toEqual(["member-1", "member-2"]);
  expect(s.b.room.getParty()!.notes.map((n) => n.text)).not.toContain("joined");
  s.a.room.setRules({ locked: false });
  s.sim.run(1000);
  const d = third(s);
  s.sim.run(3000);
  await flush();
  expect(d.result).toBe("joined");
});

test("Approve joins: the joiner waits, unseen, until the host lets it in or turns it away", async () => {
  const s = partyOfTwo();
  s.sim.run(3000);
  s.a.room.setRules({ approve: true });
  s.sim.run(1000);
  const c = third(s);
  s.sim.run(15_000); // longer than a join waits for a room that doesn't answer
  await flush();
  expect(c.result).toBeUndefined();
  expect(c.room.getParty()!.knocking).toBe(true);
  expect(s.a.room.getParty()!.knockers.map((k) => k.name)).toEqual(["Cy"]);
  expect(ids(s.b)).toEqual(["member-1", "member-2"]);
  expect(s.a.room.getParty()!.playback!.held).toBe(false); // not waited for either
  // Its actions aren't the room's.
  c.room.partyAct({ paused: true });
  s.sim.run(1000);
  expect(s.a.room.getParty()!.playback!.paused).toBe(false);
  s.a.room.admit("member-3");
  s.sim.run(2000);
  await flush();
  expect(c.result).toBe("joined");
  expect(ids(s.b)).toEqual(["member-1", "member-2", "member-3"]);
  expect(s.a.room.getParty()!.knockers).toEqual([]);

  const d = third(s);
  s.sim.run(2000);
  s.a.room.deny("member-4");
  s.sim.run(2000);
  await flush();
  expect(d.result).toBe("The host didn't let you in.");
});

test("only the host controls playback: a member's pause goes nowhere and its player follows the room", async () => {
  const s = partyOfTwo();
  s.sim.run(3000);
  s.a.room.setRules({ control: "host" });
  s.sim.run(1000);
  s.mb.pause();
  s.sim.run(3000);
  expect(s.a.room.getParty()!.playback!.paused).toBe(false);
  expect(s.mb.paused).toBe(false);
  expect(s.b.room.getParty()!.notes.map((n) => n.text)).toContain("Only the host controls playback in this party.");
  s.ma.pause();
  s.sim.run(2000);
  expect(s.mb.paused).toBe(true);
});

test("End party: over for everyone, and each is told", async () => {
  const s = partyOfTwo();
  s.sim.run(3000);
  s.a.room.endParty();
  s.sim.run(1000);
  expect(s.a.room.getParty()).toBeNull();
  expect(s.b.room.getParty()).toBeNull();
  expect(s.b.room.getExit()?.text).toBe(ENDED);
  s.b.room.dismissExit();
  expect(s.b.room.getExit()).toBeNull();
});

test("the host leaving passes the role to the next member, and everyone is told", async () => {
  const s = partyOfTwo();
  const c = third(s);
  s.sim.run(5000);
  s.a.room.leaveParty();
  s.sim.run(1000);
  expect(s.b.room.getParty()!.hostId).toBe("member-2");
  expect(c.room.getParty()!.hostId).toBe("member-2");
  expect(c.room.getParty()!.notes.map((n) => n.text)).toContain("is now the host");
  // The new host's rules hold: it can lock, and the third member sees it.
  s.b.room.setRules({ locked: true });
  s.sim.run(1000);
  expect(c.room.getParty()!.rules.locked).toBe(true);
});

test("a handed-over host's party still lets a newcomer in", async () => {
  const s = partyOfTwo();
  s.sim.run(3000);
  s.a.room.makeHost("member-2");
  s.sim.run(2000);
  const c = third(s);
  s.sim.run(3000);
  await flush();
  expect(c.result).toBe("joined");
  expect(c.room.getParty()!.hostId).toBe("member-2");
});

test("Wait for everyone off: someone loading doesn't hold the room", async () => {
  const s = partyOfTwo();
  s.sim.run(3000);
  s.a.room.setRules({ wait: false });
  s.sim.run(1000);
  s.b.room.setPartyWaiting(true);
  s.sim.run(3000);
  expect(statusOf(s.a.room.getParty()!, "member-2")).toBe("Loading");
  expect(s.a.room.getParty()!.playback!.held).toBe(false);
  s.a.room.setRules({ wait: true });
  s.sim.run(3000);
  expect(s.a.room.getParty()!.playback!.held).toBe(true);
});

test("how far behind a member is, from where its player says it is", async () => {
  const s = partyOfTwo();
  s.sim.run(5000);
  const room = s.a.room.expectedPosition(s.a.room.getParty()!.playback!);
  s.b.room.reportPosition(MEDIA.videoId, room - 6, false);
  s.sim.run(500);
  expect(s.a.room.behind("member-2")).toBeGreaterThan(5);
  expect(s.a.room.behind("member-2")).toBeLessThan(7);
  s.b.room.reportPosition(MEDIA.videoId, s.b.room.expectedPosition(s.b.room.getParty()!.playback!), false);
  s.sim.run(500);
  expect(s.a.room.behind("member-2")).toBeUndefined();
});

test("a member who drops off presence shows as Disconnected before it's gone", async () => {
  const s = partyOfTwo();
  s.sim.run(3000);
  s.hub.dropTracks.add("member-2"); // can't come back
  s.hub.lose("member-2");
  s.sim.run(1000);
  expect(statusOf(s.a.room.getParty()!, "member-2")).toBe("Disconnected");
  s.sim.run(10_000);
  expect(statusOf(s.a.room.getParty()!, "member-2")).toBe("gone");
});

test("muted: no join or leave notes, but actions still show", async () => {
  const s = partyOfTwo();
  s.sim.run(3000);
  s.a.room.setQuiet(true);
  const c = third(s);
  s.sim.run(3000);
  await flush();
  expect(c.result).toBe("joined");
  c.room.setPartyAway(true); // browsing, so the room doesn't hold for it
  s.sim.run(3000);
  s.mb.pause();
  s.sim.run(1000);
  const notes = s.a.room.getParty()!.notes.map((n) => n.text);
  expect(notes).not.toContain("joined");
  expect(notes).toContain("paused");
});
