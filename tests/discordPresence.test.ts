import { describe, expect, test } from "bun:test";
import { discordActivity, sameActivity, type Playing } from "../src/lib/playback/discordPresence";

const now = 1_000_000;
const film: Playing = { name: "The Lantern Keepers", poster: "https://media.example.com/poster.jpg", paused: false, ended: false, current: 60, duration: 600, rate: 1 };
const episode: Playing = { ...film, episode: { season: 2, episode: 5, title: "The Long Night" } };

describe("Discord Rich Presence (#31)", () => {
  test("off, nothing playing or ended: nothing shown", () => {
    expect(discordActivity("off", film, now)).toBeNull();
    expect(discordActivity("title", null, now)).toBeNull();
    expect(discordActivity("title", { ...film, ended: true }, now)).toBeNull();
  });

  test("the title, season and episode, the poster and the time left while it plays", () => {
    expect(discordActivity("title", episode, now)).toEqual({
      details: "The Lantern Keepers",
      state: "S2 E5 · The Long Night",
      start: now - 60_000,
      end: now + 540_000,
      image: "https://media.example.com/poster.jpg",
      imageText: "The Lantern Keepers",
    });
    // At double speed it ends twice as soon.
    expect(discordActivity("title", { ...film, rate: 2 }, now)).toMatchObject({ start: now - 30_000, end: now + 270_000 });
  });

  test("paused: said so, without a running clock", () => {
    const a = discordActivity("title", { ...episode, paused: true }, now);
    expect(a).toMatchObject({ state: "S2 E5 · The Long Night · Paused" });
    expect(a?.start).toBeUndefined();
    expect(discordActivity("title", { ...film, paused: true }, now)?.state).toBe("Paused");
  });

  test("only that Polarity is in use: no title, episode or picture", () => {
    expect(discordActivity("app", episode, now)).toEqual({ details: "Watching on Polarity", state: undefined, start: now - 60_000, end: now + 540_000 });
    expect(discordActivity("app", { ...episode, paused: true }, now)).toEqual({ details: "Watching on Polarity", state: "Paused" });
  });

  test("buttons (#153): Watch in Polarity only where the title is shown, Join watch party in either", () => {
    const links = { watch: "https://getpolar.app/watch?type=series&id=tt0000000", party: "https://getpolar.app/party?t=xxx" };
    expect(discordActivity("title", episode, now, links)?.buttons).toEqual([
      { label: "Watch in Polarity", url: links.watch },
      { label: "Join watch party", url: links.party },
    ]);
    expect(discordActivity("app", episode, now, links)?.buttons).toEqual([{ label: "Join watch party", url: links.party }]);
    expect(discordActivity("app", episode, now, { watch: links.watch })?.buttons).toBeUndefined();
    expect(discordActivity("title", episode, now)?.buttons).toBeUndefined();
    // A new join link is news; the same one isn't.
    const a = discordActivity("app", episode, now, links);
    expect(sameActivity(a, discordActivity("app", episode, now, { ...links }))).toBe(true);
    expect(sameActivity(a, discordActivity("app", episode, now, { party: "https://getpolar.app/party?t=yyy" }))).toBe(false);
    expect(sameActivity(a, discordActivity("app", episode, now))).toBe(false);
  });

  test("specials, placeholder episode names, live streams and pictures that aren't https", () => {
    expect(discordActivity("title", { ...film, episode: { season: 0, episode: 3 } }, now)?.state).toBe("Special 3");
    expect(discordActivity("title", { ...film, episode: { season: 1, episode: 4, title: "Episode 4" } }, now)?.state).toBe("S1 E4");
    expect(discordActivity("title", { ...film, duration: Infinity }, now)?.end).toBeUndefined();
    expect(discordActivity("title", { ...film, poster: "http://media.example.com/p.jpg" }, now)?.image).toBeUndefined();
  });

  test("the clock drifting a little isn't news; a seek or a pause is", () => {
    const a = discordActivity("title", film, now);
    expect(sameActivity(a, discordActivity("title", { ...film, current: 61 }, now + 1500))).toBe(true);
    expect(sameActivity(a, discordActivity("title", { ...film, current: 200 }, now))).toBe(false);
    expect(sameActivity(a, discordActivity("title", { ...film, paused: true }, now))).toBe(false);
    expect(sameActivity(null, null)).toBe(true);
    expect(sameActivity(a, null)).toBe(false);
  });
});
