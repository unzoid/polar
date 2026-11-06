import { describe, expect, test } from "bun:test";
import { pickedSpeed, pickedTrack, speedMenu, tracksMenu } from "../src/components/player/nativeMenus";

describe("the player's iOS menus", () => {
  test("speed: every speed, the current one ticked, the pick read back", () => {
    const menu = speedMenu([0.5, 1, 1.5], 1.5);
    expect(menu.actions.map((a) => [a.label, a.checked])).toEqual([
      ["0.5x", false],
      ["1x (Normal)", false],
      ["1.5x", true],
    ]);
    expect(pickedSpeed(menu.actions[0].id)).toBe(0.5);
    expect(pickedSpeed(null)).toBeNull();
    expect(pickedSpeed("x")).toBeNull();
  });

  const tracks = {
    audio: [
      { id: "1", label: "English · 5.1" },
      { id: "2", label: "Commentary" },
    ],
    audioId: "2",
    subtitles: [
      { id: "off", label: "Off" },
      { id: "ext:en", label: "English" },
    ],
    subId: "ext:en",
    subtitlesLoading: false,
  };

  test("subtitles & audio: two submenus with the current tracks ticked, then the settings", () => {
    const menu = tracksMenu(tracks);
    const [audio, subs, settings] = menu.actions;
    expect(audio.children?.map((a) => a.checked)).toEqual([false, true]);
    expect(subs.label).toBe("Subtitles");
    expect(subs.children?.map((a) => a.checked)).toEqual([false, true]);
    expect(settings.children).toBeUndefined();
    expect(settings.group).not.toBe(audio.group);
    // Ids are unique across the whole menu, since the answer is one id.
    const ids = menu.actions.flatMap((a) => [a.id, ...(a.children ?? []).map((c) => c.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("subtitles & audio: each pick read back, a subtitle id's own colon kept", () => {
    const [audio, subs, settings] = tracksMenu(tracks).actions;
    expect(pickedTrack(audio.children![0].id)).toEqual({ audio: "1" });
    expect(pickedTrack(subs.children![1].id)).toEqual({ subtitle: "ext:en" });
    expect(pickedTrack(subs.children![0].id)).toEqual({ subtitle: "off" });
    expect(pickedTrack(settings.id)).toBe("settings");
    expect(pickedTrack(null)).toBeNull();
    expect(pickedTrack("audio")).toBeNull();
  });

  test("no audio tracks: Default, ticked, picks nothing; subtitles still loading say so", () => {
    const menu = tracksMenu({ ...tracks, audio: [], subtitlesLoading: true });
    expect(menu.actions[0].children).toEqual([{ id: "audio:default", label: "Default", style: "default", checked: true }]);
    expect(pickedTrack("audio:default")).toBeNull();
    expect(menu.actions[1].label).toContain("loading");
  });
});
