import { expect, test } from "bun:test";
import "./storageStub";
import { NEUTRAL, scoreOne, scoreSources, WEIGHTS, type Device, type MatchContext, type SourceRecord } from "../src/lib/playback/bestMatch";
import { deviceCaps } from "../src/lib/playback/device";
import { autoPickOrder } from "../src/lib/playback/sources";
import {
  connectionMbps,
  recordFail,
  recordPlayedThrough,
  recordStart,
  recordThroughput,
  recordTry,
  resetSourceHistory,
  sourceRecord,
} from "../src/lib/playback/sourceHistory";
import type { RankedStream, StreamQuality } from "../src/lib/types";

// #230. Every release name here is made up.

const GB = 1e9;
const TWO_HOURS = 7200;

function source(title: string, q: Partial<StreamQuality> = {}, addon = "Open Films"): RankedStream {
  return {
    stream: { url: `https://media.example.com/${encodeURIComponent(title)}.mkv`, title },
    addon,
    quality: { resolution: 1080, hdr: false, dolbyVision: false, lowQualitySource: false, direct: true, languages: [], tags: [], ...q },
    label: title,
  };
}

const device = (d: Partial<Device> = {}): Device => ({ screen: 1080, preferScreen: true, hdr: false, dolbyVision: null, hevc: null, av1: null, ...d });
const ctx = (c: Partial<MatchContext> = {}): MatchContext => ({ ...NEUTRAL, device: device(), runtimeSec: TWO_HOURS, now: 1e12, ...c });
const reasons = (r: RankedStream, c: MatchContext, list = [r]) => Object.fromEntries(scoreSources(list, c).get(r)!.reasons.map((x) => [x.reason, x.points]));
const top = (list: RankedStream[], c: MatchContext) => {
  const scores = scoreSources(list, c);
  return [...list].sort((a, b) => scores.get(b)!.score - scores.get(a)!.score)[0].label;
};

// --- Each rule ------------------------------------------------------------

test("the picture's height, against this screen", () => {
  const uhd = source("Quiet.Orchard.2030.2160p.WEB-DL-NOTREAL", { resolution: 2160 });
  expect(reasons(uhd, ctx())).toEqual({ "4K on a 1080p screen": 40, "Bigger than this screen shows": WEIGHTS.overScreen, "Direct link": 10 });
  expect(reasons(uhd, ctx({ device: device({ screen: 2160 }) }))).toEqual({ "4K on a 4K screen": 40, "Direct link": 10 });
  // "Prefer this screen" off: the height alone.
  expect(reasons(uhd, ctx({ device: device({ preferScreen: false }) }))).toEqual({ "4K": 40, "Direct link": 10 });
  expect(reasons(source("Quiet.Orchard.2030.WEB-NOTREAL", { resolution: undefined, direct: false }), ctx())).toEqual({ "Unknown resolution": 15 });
});

test("size alone never costs points: a big film at a sensible bitrate isn't pushed down", () => {
  // 62 GB over three hours: 46 Mbps, a remux's.
  const remux = source("Long.Voyage.2029.2160p.UHD.BluRay.Remux-MADEUP", { resolution: 2160, sizeBytes: 62 * GB });
  const web = source("Long.Voyage.2029.2160p.WEB-DL-MADEUP", { resolution: 2160, sizeBytes: 18 * GB });
  const c = ctx({ runtimeSec: 3 * 3600, device: device({ screen: 2160 }) });
  expect(Object.values(reasons(remux, c, [remux, web])).every((p) => p > 0)).toBe(true);
  expect(scoreSources([remux, web], c).get(remux)!.score).toBe(scoreSources([remux, web], c).get(web)!.score);
  // Nothing anywhere says "Over 40 GB".
  expect(JSON.stringify(WEIGHTS)).not.toContain("40 GB");
});

test("bitrate: too low for its height, and against the other files of that height", () => {
  const files = [
    source("Paper.Moon.Bay.2031.1080p.WEBRip-SQUEEZE", { sizeBytes: 1.2 * GB }), // 1.3 Mbps
    source("Paper.Moon.Bay.2031.1080p.WEB-DL-PLAIN", { sizeBytes: 4 * GB }), // 4.4
    source("Paper.Moon.Bay.2031.1080p.WEB-DL-OTHER", { sizeBytes: 5 * GB }), // 5.6
    source("Paper.Moon.Bay.2031.1080p.BluRay-RICH", { sizeBytes: 12 * GB }), // 13.3
  ];
  expect(reasons(files[0], ctx(), files)["1.3 Mbps is low for 1080p"]).toBe(WEIGHTS.bitrateLow);
  expect(reasons(files[3], ctx(), files)["13 Mbps, more detail than the other 1080p files' 5 Mbps"]).toBe(WEIGHTS.bitrateAboveOthers);
  // Half the middle: a re-encode squeezed small, though above the floor.
  const thin = source("Paper.Moon.Bay.2031.1080p.WEB-THIN", { sizeBytes: 2.4 * GB }); // 2.7 Mbps
  const many = [...files.slice(1), thin, source("Paper.Moon.Bay.2031.1080p.WEB-DL-MORE", { sizeBytes: 6 * GB })];
  expect(reasons(thin, ctx(), many)["2.7 Mbps, under half the other 1080p files' 5.6 Mbps"]).toBe(WEIGHTS.bitrateBelowOthers);
  // Without the runtime there's no bitrate, and no points for it.
  expect(Object.keys(reasons(files[0], ctx({ runtimeSec: null }), files))).toEqual(["1080p on a 1080p screen", "Direct link"]);
});

test("bitrate against the connection: more than it carries loses, close to it loses a little", () => {
  const rich = source("Glass.Coast.2028.1080p.BluRay-RICH", { sizeBytes: 12 * GB }); // 13.3 Mbps
  expect(reasons(rich, ctx({ connectionMbps: 10 }))["13 Mbps is more than this connection carries (10 Mbps)"]).toBe(WEIGHTS.connectionTooSlow);
  expect(reasons(rich, ctx({ connectionMbps: 20 }))["13 Mbps is close to this connection's 20 Mbps"]).toBe(WEIGHTS.connectionTight);
  expect(Object.keys(reasons(rich, ctx({ connectionMbps: 100 })))).toEqual(["1080p on a 1080p screen", "Direct link"]);
});

test("HDR and Dolby Vision against the display", () => {
  const hdr = source("Ember.Field.2032.2160p.WEB-DL.HDR-NOTREAL", { resolution: 2160, hdr: true });
  expect(reasons(hdr, ctx({ device: device({ screen: 2160, hdr: true }) }))["HDR on an HDR screen"]).toBe(WEIGHTS.hdr);
  // An SDR screen: no bonus.
  expect(Object.keys(reasons(hdr, ctx({ device: device({ screen: 2160, hdr: false }) }))).some((k) => k.includes("HDR"))).toBe(false);
  const dvOnly = source("Ember.Field.2032.2160p.WEB-DL.DV-NOTREAL", { resolution: 2160, dolbyVision: true });
  expect(reasons(dvOnly, ctx({ device: device({ dolbyVision: false }) }))["Dolby Vision only, which this device can't show"]).toBe(WEIGHTS.dolbyVisionUnsupported);
  expect(reasons(dvOnly, ctx({ device: device({ hdr: true, dolbyVision: true }) }))["Dolby Vision on an HDR screen"]).toBe(WEIGHTS.dolbyVision);
  // With an HDR10 layer it still plays right: no loss.
  const both = source("Ember.Field.2032.2160p.WEB-DL.DV.HDR-NOTREAL", { resolution: 2160, dolbyVision: true, hdr: true });
  expect(Object.values(reasons(both, ctx({ device: device({ dolbyVision: false }) }))).every((p) => p > 0 || p === WEIGHTS.overScreen)).toBe(true);
});

test("HEVC and AV1 against hardware decoding", () => {
  const hevc = source("Salt.Line.2030.1080p.WEB-DL.HEVC-NOTREAL", { codec: "HEVC" });
  const av1 = source("Salt.Line.2030.2160p.WEB-DL.AV1-NOTREAL", { codec: "AV1", resolution: 2160 });
  expect(reasons(hevc, ctx({ device: device({ hevc: true }) }))["HEVC, decoded by this device's hardware"]).toBe(WEIGHTS.efficientCodec);
  expect(reasons(hevc, ctx({ device: device({ hevc: false }) }))["HEVC without hardware decoding here"]).toBe(WEIGHTS.softwareDecode);
  expect(reasons(av1, ctx({ device: device({ av1: false }) }))["AV1 without hardware decoding here"]).toBe(WEIGHTS.softwareDecode * 2);
  // Unknown: nothing either way.
  expect(Object.keys(reasons(hevc, ctx()))).toEqual(["1080p on a 1080p screen", "Direct link"]);
});

test("preferences are weights: audio language, tags, release groups", () => {
  const ita = source("Night.Ferry.2029.1080p.WEB-DL.ITA-MADEUP", { languages: ["it"] });
  const multi = source("Night.Ferry.2029.1080p.WEB-DL.MULTi-MADEUP", { languages: ["multi"] });
  const c = ctx({ audioLanguage: "it" });
  expect(reasons(ita, c)["Audio in Italian, your language"]).toBe(WEIGHTS.audioLanguage);
  expect(reasons(multi, c)["Multi-audio, may have your language"]).toBe(WEIGHTS.audioMulti);
  const remux = source("Night.Ferry.2029.1080p.BluRay.Remux.Atmos-MADEUP", { tags: ["Remux", "Atmos"] });
  const t = reasons(remux, ctx({ preferredTags: ["remux", "atmos", "dv"] }));
  expect([t["Remux, which you prefer"], t["Atmos, which you prefer"], t["Dolby Vision, which you prefer"]]).toEqual([3, 3, undefined]);
  const groups = ["First Crew", "second-crew", "Third", "Fourth", "Fifth"];
  const g = (name: string) => scoreOne(source(`[${name}] Night Ferry - 01`, { source: name }), ctx({ preferredGroups: groups })).reasons.find((x) => x.reason.includes("group"))?.points;
  expect(["FIRST-CREW", "Second Crew", "Third", "Fourth", "Fifth", "Nobody"].map(g)).toEqual([12, 9, 6, 3, 3, undefined]);
});

test("the best compromise wins when nothing matches every preference", () => {
  // Italian audio and Remux preferred; no source has both.
  const ita = source("Low.Tide.2031.1080p.WEB-DL.ITA-MADEUP", { languages: ["it"], sizeBytes: 5 * GB });
  const remux = source("Low.Tide.2031.1080p.BluRay.Remux-MADEUP", { languages: ["en"], tags: ["Remux"], sizeBytes: 25 * GB });
  const neither = source("Low.Tide.2031.1080p.WEB-DL-MADEUP", { languages: ["en"], sizeBytes: 5 * GB });
  const c = ctx({ audioLanguage: "it", preferredTags: ["remux"] });
  expect(top([neither, remux, ita], c)).toBe(ita.label);
  // Without the language preference, the Remux.
  expect(top([neither, ita, remux], ctx({ preferredTags: ["remux"] }))).toBe(remux.label);
});

test("what worked before: failures, play-throughs, slow starts, a recent failure fading out", () => {
  const rec = (r: Partial<SourceRecord>): SourceRecord => ({ tries: 0, starts: 0, fails: 0, through: 0, startMs: 0, ...r });
  const now = 1e12;
  const history = (kind: "addon" | "group", name: string) =>
    kind === "addon" && name === "Shaky"
      ? rec({ tries: 3, fails: 2, starts: 1, startMs: 15_000, lastFail: now - 12 * 3_600_000 })
      : kind === "group" && name === "STEADY"
        ? rec({ tries: 4, starts: 4, through: 3, startMs: 8_000 })
        : undefined;
  const c = ctx({ history, now });
  const shaky = reasons(source("Far.Shore.2030.1080p.WEB-DL-NOTREAL", {}, "Shaky"), c);
  expect(shaky["Add-on failed 2 of 3 times here"]).toBe(-8);
  expect(shaky["Failed here 12 h ago"]).toBe(-7.5);
  // One start isn't enough to say it's slow.
  expect(Object.keys(shaky).some((k) => k.includes("to start"))).toBe(false);
  const steady = reasons(source("Far.Shore.2030.1080p.WEB-DL-STEADY", { source: "STEADY" }), c);
  expect(steady["Release group played through 3 of 4 times here"]).toBe(3);
  // A failure a day ago no longer counts as recent.
  const old = reasons(source("Far.Shore.2030.1080p.WEB-DL-NOTREAL", {}, "Shaky"), ctx({ history, now: now + 12 * 3_600_000 }));
  expect(Object.keys(old).some((k) => k.startsWith("Failed here"))).toBe(false);
  const slow = (kind: "addon" | "group", name: string) => (kind === "addon" && name === "Slow" ? rec({ tries: 2, starts: 2, startMs: 30_000 }) : undefined);
  expect(reasons(source("Far.Shore.2030.1080p.WEB-DL-NOTREAL", {}, "Slow"), ctx({ history: slow }))["Add-on takes 15 s to start here"]).toBe(WEIGHTS.slowStart);
});

test("a file of another episode never ranks at the top, nor a CAM", () => {
  const other = { ...source("Harbor.Lights.S01E06.2160p.WEB-DL.HDR-NOTREAL", { resolution: 2160, hdr: true }), otherEpisode: true, fileEpisode: "S01E06" };
  const cam = source("Harbor.Lights.2031.HDCAM-NOTREAL", { lowQualitySource: true, resolution: 2160 });
  const right = source("Harbor.Lights.S01E05.480p.WEB-NOTREAL", { resolution: 480 });
  expect(reasons(other, ctx())["The file says S01E06"]).toBe(WEIGHTS.otherEpisode);
  expect(top([other, cam, right], ctx())).toBe(right.label);
});

// --- Whole lists: who's watching where ---------------------------------------

/** One film's sources, from add-ons and groups that don't exist. */
const FILM = [
  source("Driftwood.Harbor.2031.2160p.UHD.BluRay.Remux.DV.HDR.HEVC.TrueHD.Atmos-INVENTED", {
    resolution: 2160,
    hdr: true,
    dolbyVision: true,
    codec: "HEVC",
    sizeBytes: 62 * GB,
    tags: ["Remux", "TrueHD", "Atmos"],
  }),
  source("Driftwood.Harbor.2031.2160p.WEB-DL.HDR.HEVC-PLACEHOLDER", { resolution: 2160, hdr: true, codec: "HEVC", sizeBytes: 16 * GB }),
  source("Driftwood.Harbor.2031.1080p.BluRay.x264-MADEUP", { codec: "H.264", sizeBytes: 12 * GB }),
  source("Driftwood.Harbor.2031.1080p.WEB-DL.HEVC-NOTREAL", { codec: "HEVC", sizeBytes: 4 * GB }),
  source("Driftwood.Harbor.2031.1080p.WEBRip.x265-TINY", { codec: "HEVC", sizeBytes: 1.2 * GB }),
  source("Driftwood.Harbor.2031.1080p.WEB-DL.H264-FICTION", { codec: "H.264", sizeBytes: 6 * GB }),
  source("Driftwood.Harbor.2031.720p.WEB.x264-SMALLFRY", { resolution: 720, codec: "H.264", sizeBytes: 1.5 * GB }),
];

test("an SDR laptop on slow Wi-Fi: a 1080p file the connection carries", () => {
  const laptop = ctx({ device: device({ screen: 1080, hdr: false, dolbyVision: false, hevc: true }), connectionMbps: 8 });
  expect(top(FILM, laptop)).toBe("Driftwood.Harbor.2031.1080p.WEB-DL.HEVC-NOTREAL");
});

test("a 4K HDR TV on fast wired: the 4K remux, Dolby Vision and all", () => {
  const tv = ctx({ device: device({ screen: 2160, hdr: true, dolbyVision: true, hevc: true, av1: true }), connectionMbps: 300 });
  expect(top(FILM, tv)).toBe("Driftwood.Harbor.2031.2160p.UHD.BluRay.Remux.DV.HDR.HEVC.TrueHD.Atmos-INVENTED");
});

test("a phone without HEVC decoding: the best H.264 file", () => {
  const phone = ctx({ device: device({ screen: 1080, hdr: false, dolbyVision: false, hevc: false, av1: false }), connectionMbps: 40 });
  expect(top(FILM, phone)).toBe("Driftwood.Harbor.2031.1080p.BluRay.x264-MADEUP");
});

test("autoplay tries sources in Best Match's order", () => {
  const laptop = ctx({ device: device({ screen: 1080, hdr: false, dolbyVision: false, hevc: true }), connectionMbps: 8 });
  expect(autoPickOrder(FILM, undefined, undefined, laptop)[0].label).toBe("Driftwood.Harbor.2031.1080p.WEB-DL.HEVC-NOTREAL");
});

// --- The device and the history kept on it -----------------------------------

test("mpv with hardware decoding off decodes in software; the built-in player asks the system", () => {
  const system = { hevc: true, av1: null, dolbyVision: false };
  expect(deviceCaps("mpv", false, system, true)).toEqual({ hdr: true, dolbyVision: true, hevc: false, av1: false });
  expect(deviceCaps("mpv", true, system, true)).toEqual({ hdr: true, dolbyVision: true, hevc: true, av1: null });
  expect(deviceCaps("html", true, system, false)).toEqual({ hdr: false, dolbyVision: false, hevc: true, av1: null });
});

test("the history is kept per add-on and per release group, on this device", () => {
  const kind = { addon: "Open Films", group: "MADEUP" };
  recordTry(kind, 1);
  recordStart(kind, 2500, 2);
  recordPlayedThrough(kind, 3);
  recordTry(kind, 4);
  recordFail(kind, 5);
  const want = { tries: 2, starts: 1, fails: 1, through: 1, startMs: 2500, lastFail: 5 };
  expect(sourceRecord("addon", "open films")).toEqual(want);
  expect(sourceRecord("group", "MADEUP")).toEqual(want);
  // A source the user picked by hand has neither: nothing is kept.
  recordTry({}, 6);
  recordThroughput(20);
  recordThroughput(10);
  expect(connectionMbps()).toBe(17);
  // It's still there after a restart.
  resetSourceHistory(localStorage);
  expect(sourceRecord("addon", "Open Films")).toEqual(want);
  expect(connectionMbps()).toBe(17);
  // Nothing about a title or a link is kept.
  expect(localStorage.getItem("polar.sourceHistory")).not.toContain("http");
});
