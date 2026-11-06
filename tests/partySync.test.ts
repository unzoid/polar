// Two simulated watch-party members (#155) on tests/partySim.ts.
import { expect, test } from "bun:test";
import { GONE_MS, SETTLE_MS } from "../src/lib/party/room";
import { partyOfTwo, statusOf } from "./partySim";

// --- Tests -------------------------------------------------------------------

test("joining a paused party leaves it paused, and the joiner lands paused at the same frame", () => {
  const { sim, a, b, ma, mb } = partyOfTwo({}, { pauseFirst: true });
  // Never playing, on either side, from the moment B joined.
  const playedA: boolean[] = [];
  const unsub = a.room.getParty() && sim.every(() => playedA.push(!a.room.getParty()!.playback!.paused, !ma.paused), 50);
  // Like mpv: the engine reports its start once more after it has been told to pause.
  mb.addEventListener("started", () => sim.after(() => mb.report(true), 100), { once: true });
  sim.run(15_000);
  unsub?.();
  expect(playedA.some(Boolean)).toBe(false);
  expect(b.room.getParty()!.playback!.paused).toBe(true);
  expect(ma.paused && mb.paused).toBe(true);
  expect(Math.abs(ma.currentTime - mb.currentTime)).toBeLessThan(0.5);
  expect(statusOf(a.room.getParty()!, "member-2")).toBe("Paused");
  expect(statusOf(b.room.getParty()!, "member-1")).toBe("Paused");
});

test("ten minutes of play with pauses and seeks keeps two drifting players within a second", () => {
  // B's engine runs 1% fast, A's slightly slow: 7 s apart after ten minutes if nobody corrected.
  const { sim, ma, mb } = partyOfTwo({ skew: 1.01, engineLag: 120, seekMs: 900 });
  (ma as unknown as { o: { skew: number } }).o.skew = 0.998;
  sim.run(10_000);
  let worst = 0;
  let quietUntil = 0;
  const actions: [number, () => void][] = [
    [60, () => ma.pause()],
    [70, () => mb.play()],
    [150, () => (mb.currentTime = mb.currentTime + 300)],
    [260, () => mb.pause()],
    [275, () => ma.play()],
    [380, () => (ma.currentTime = ma.currentTime - 120)],
    [470, () => mb.pause()],
    [480, () => mb.play()],
  ];
  for (let s = 1; s <= 600; s++) {
    for (const [at, act] of actions)
      if (at === s) {
        act();
        quietUntil = s + 6; // a seek or resume takes a few seconds to settle on both
      }
    sim.run(1000);
    if (s > quietUntil) worst = Math.max(worst, Math.abs(ma.currentTime - mb.currentTime));
  }
  expect(worst).toBeLessThan(1);
  // Each player is held within the nudge band (0.3 s) of the room, so two may sit up to twice that apart.
  expect(Math.abs(ma.currentTime - mb.currentTime)).toBeLessThan(0.65);
});

test("an action the others missed still reaches them, instead of each side keeping its own timeline", () => {
  const { sim, hub, b, ma, mb } = partyOfTwo();
  sim.run(5000);
  // B pauses, and that message is lost on its way to A (the host).
  hub.dropMessages.add("member-2");
  mb.pause();
  sim.run(300);
  hub.dropMessages.clear();
  sim.run(15_000);
  expect(b.room.getParty()!.playback!.paused).toBe(true);
  expect(ma.paused && mb.paused).toBe(true);
  expect(Math.abs(ma.currentTime - mb.currentTime)).toBeLessThan(0.5);
});

test("leaving the player is Away on both screens, even when the server loses the update", () => {
  const { sim, hub, a, b } = partyOfTwo();
  sim.run(5000);
  expect(statusOf(a.room.getParty()!, "member-2")).toBe("Watching");
  b.stop!();
  sim.run(SETTLE_MS + 1000);
  expect(statusOf(a.room.getParty()!, "member-2")).toBe("Away");
  expect(statusOf(b.room.getParty()!, "member-2")).toBe("Away");
  // The server forgets B's presence while B is still connected: B notices and comes back
  // before A gives up on it, so A never shows B as gone.
  const notes: string[] = [];
  const watchNotes = sim.every(() => a.room.getParty()!.notes.forEach((n) => notes.push(n.text)), 100);
  hub.lose("member-2");
  sim.run(GONE_MS * 3);
  watchNotes();
  expect(notes).not.toContain("left");
  expect(statusOf(a.room.getParty()!, "member-2")).toBe("Away");
  expect(b.room.getParty()!.members.map((m) => m.id)).toEqual(a.room.getParty()!.members.map((m) => m.id));
});

test("Leave Party is gone for everyone at once", () => {
  const { sim, a, b } = partyOfTwo();
  sim.run(5000);
  b.stop!();
  b.room.leaveParty();
  expect(b.room.getParty()).toBeNull();
  sim.run(500); // well inside the grace for a presence blip
  expect(statusOf(a.room.getParty()!, "member-2")).toBe("gone");
  expect(a.room.getParty()!.notes.map((n) => n.text)).toContain("left");
});

test("a status update the server drops is sent again, so 'Loading' clears everywhere", () => {
  const { sim, hub, a, b } = partyOfTwo();
  // B's "loaded" update is lost: B shows itself as it is, and re-sends until A agrees.
  hub.dropTracks.add("member-2");
  sim.run(3000);
  expect(statusOf(b.room.getParty()!, "member-2")).toBe("Watching");
  hub.dropTracks.clear();
  sim.run(8000);
  expect(statusOf(a.room.getParty()!, "member-2")).toBe("Watching");
  expect(a.room.getParty()!.playback!.held).toBe(false);
});
