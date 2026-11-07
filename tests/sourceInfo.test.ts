import { expect, test } from "bun:test";
import "./storageStub";
import { describeRequest, looksSecret, MASK, maskText, maskUrl, sourceInfo, sourceInfoText } from "../src/lib/playback/sourceInfo";
import { NO_FILTER } from "../src/lib/playback/sources";
import type { RankedStream } from "../src/lib/types";

// Invented keys, one per place a key turns up in add-on and stream links.
const KEYS = {
  password: "Pw0rdXyz77",
  query: "Q1w2e3r4t5y6u7i8o9p0",
  shortQuery: "k3y",
  hexPath: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  afterWord: "abc123",
  base64Config: "eyJ0b2tlbiI6IkFCQ0RFRkcxMjM0NSJ9",
  jsonConfig: "%7B%22apiKey%22%3A%22K9xZz%22%7D",
  uuid: "123e4567-e89b-12d3-a456-426614174000",
  fragment: "Fr4gm3ntT0k3nValue99",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  header: "Bearer HdrT0kenValue1234567",
  cookie: "session=C00kieValue9876",
  textKey: "TxtK3yValue",
  hint: "H1ntSecretValue2468",
};

const ALL_URLS = [
  `https://user:${KEYS.password}@media.example.com/film.mkv`,
  `https://media.example.com/film.mkv?apikey=${KEYS.query}&lang=en&t=${KEYS.shortQuery}`,
  `https://media.example.com/${KEYS.hexPath}/film.mkv`,
  `https://media.example.com/token/${KEYS.afterWord}/film.mkv`,
  `https://addon.example.org/${KEYS.base64Config}/stream/movie/tt0000000.json`,
  `https://addon.example.org/${KEYS.jsonConfig}/manifest.json`,
  `https://media.example.com/files/${KEYS.uuid}/film.mkv`,
  `https://media.example.com/film.mkv#access_token=${KEYS.fragment}`,
  `https://media.example.com/${KEYS.jwt}/film.mkv`,
];

function secretsIn(text: string) {
  const plain = Object.values(KEYS).flatMap((k) => [k, decodeURIComponent(k)]);
  // Pieces of a key count too: half a token is still a leak.
  return plain.filter((k) => text.includes(k) || (k.length >= 12 && text.includes(k.slice(0, 12))));
}

test("links keep the scheme, the host and the shape of the path", () => {
  expect(maskUrl(ALL_URLS[0])).toBe(`https://${MASK}@media.example.com/film.mkv`);
  expect(maskUrl(ALL_URLS[1])).toBe(`https://media.example.com/film.mkv?apikey=${MASK}&lang=${MASK}&t=${MASK}`);
  expect(maskUrl(ALL_URLS[2])).toBe(`https://media.example.com/${MASK}/film.mkv`);
  expect(maskUrl(ALL_URLS[3])).toBe(`https://media.example.com/token/${MASK}/film.mkv`);
  expect(maskUrl(ALL_URLS[4])).toBe(`https://addon.example.org/${MASK}/stream/movie/tt0000000.json`);
  expect(maskUrl(ALL_URLS[5])).toBe(`https://addon.example.org/${MASK}/manifest.json`);
  expect(maskUrl(ALL_URLS[6])).toBe(`https://media.example.com/files/${MASK}/film.mkv`);
  expect(maskUrl(ALL_URLS[7])).toBe(`https://media.example.com/film.mkv#${MASK}`);
  expect(maskUrl(ALL_URLS[8])).toBe(`https://media.example.com/${MASK}/film.mkv`);
  for (const u of ALL_URLS) expect(secretsIn(maskUrl(u))).toEqual([]);
});

test("release names and file names stay readable", () => {
  expect(maskUrl("https://media.example.com/Some.Film.2024.2160p.WEB-DL.x265-GROUP.mkv")).toBe(
    "https://media.example.com/Some.Film.2024.2160p.WEB-DL.x265-GROUP.mkv",
  );
  expect(maskUrl("https://media.example.com/Pel%C3%ADcula%20Uno/S01E05.mkv")).toBe("https://media.example.com/Película Uno/S01E05.mkv");
  expect(looksSecret("Some_Film_2024_1080p_WEB")).toBe(false);
  expect(looksSecret("manifest.json")).toBe(false);
  expect(maskText("Some.Film.2024.1080p.WEB-DL.DDP5.1.H.264-GROUP")).toBe("Some.Film.2024.1080p.WEB-DL.DDP5.1.H.264-GROUP");
});

test("hosts on this computer or the home network aren't shown", () => {
  expect(maskUrl("http://192.168.1.20:8096/Videos/1/stream")).toBe("http://a-device-on-your-network/Videos/1/stream");
  expect(maskUrl("http://127.0.0.1:11470/film.mkv")).toBe("http://this-computer/film.mkv");
  expect(maskUrl("file:///home/someone/film.mkv")).toBe(`file://~/${MASK}`);
  expect(maskUrl("not a link")).toBe(MASK);
});

test("free text: links, key=value pairs, long tokens and home folders are masked", () => {
  const text = maskText(`see ${ALL_URLS[1]} with apikey=${KEYS.textKey}, token: "${KEYS.textKey}" saved in /home/someone/x`);
  expect(secretsIn(text)).toEqual([]);
  expect(text).toContain("media.example.com/film.mkv");
  expect(text).not.toContain("someone");
});

const stream = (patch: Partial<RankedStream> = {}): RankedStream => ({
  addon: "Open Films",
  stream: {
    url: ALL_URLS[4],
    externalUrl: ALL_URLS[0],
    name: "Open Films\n4K",
    title: "Some.Film.2024.2160p.WEB-DL.x265-GROUP",
    description: `Mirror: ${ALL_URLS[1]} apikey=${KEYS.textKey}`,
    behaviorHints: {
      filename: "Some.Film.2024.2160p.WEB-DL.x265-GROUP.mkv",
      videoSize: 14_200_000_000,
      bingeGroup: "open-films-4k",
      proxyHeaders: { request: { Authorization: KEYS.header, Cookie: KEYS.cookie, Referer: ALL_URLS[2] } },
      custom: KEYS.hint,
      nested: { token: KEYS.hint },
    },
  },
  quality: { resolution: 2160, hdr: true, dolbyVision: false, codec: "HEVC", sizeBytes: 14.2e9, lowQualitySource: false, direct: true, languages: ["en", "ja"], tags: ["HDR10"] },
  score: 53,
  scoreReasons: [
    { reason: "4K", points: 40 },
    { reason: "Direct link", points: 10 },
    { reason: "HDR", points: 2 },
    { reason: "HEVC", points: 1 },
  ],
  label: "4K · HDR · HEVC · 14.2 GB",
  requestId: "tt0000000:1:5",
  ...patch,
});

const rows = (r: RankedStream, ctx = {}) => new Map(sourceInfo(r, ctx).flatMap((s) => s.rows.map((x) => [x.label, x.value])));

test("the copied text contains no key from any position", () => {
  const text = sourceInfoText(sourceInfo(stream(), { filter: NO_FILTER, sort: "best", screen: 2160 }));
  expect(secretsIn(text)).toEqual([]);
  expect(text).toContain("Request header Authorization: " + MASK);
  expect(text).toContain("Request header Cookie: " + MASK);
  expect(text).toContain("filename: Some.Film.2024.2160p.WEB-DL.x265-GROUP.mkv");
  expect(text).toContain("nested: { token }");
});

test("the panel says where a source came from and what was made of it", () => {
  const m = rows(stream(), { filter: { ...NO_FILTER, res: "1080", lang: "ja" }, sort: "best", screen: 1080 });
  expect(m.get("Add-on")).toBe("Open Films");
  expect(m.get("Asked by")).toBe("IMDb tt0000000, season 1, episode 5 (tt0000000:1:5)");
  expect(m.get("Resolution")).toBe("4K (2160p)");
  expect(m.get("Audio languages")).toBe("English, Japanese");
  expect(m.get("4K")).toBe("+40");
  expect(m.get("Bigger than this screen shows")).toBe("−8");
  expect(m.get("Score")).toBe("45");
  expect(m.get("Hidden by")).toBe("Resolution");
  expect(m.get("videoSize")).toBe("14.2 GB (14200000000 bytes)");
});

test("a preferred group's boost is its own reason; another sort says so", () => {
  const m = rows(stream({ score: 2053 }), { sort: "sizeDesc", screen: 2160 });
  expect(m.get("Preferred release group")).toBe("+2000");
  expect(m.get("Score")).toBe("2053 (list sorted by Largest File)");
});

test("the playing source adds what the player reports", () => {
  const sections = sourceInfo(stream(), {
    playing: {
      container: "matroska",
      videoCodec: "hevc",
      width: 3840,
      height: 1600,
      fps: 23.976,
      videoBitrate: 18_400_000,
      tracks: [
        { type: "audio", lang: "ja", codec: "opus", channels: 2, selected: true },
        { type: "sub", lang: "en", title: "Signs", codec: "ass" },
      ],
    },
  });
  const playing = sections.find((s) => s.title === "What the Player Reports")!;
  expect(playing.rows.map((x) => `${x.label}: ${x.value}`)).toEqual([
    "Container: matroska",
    "Video codec: hevc",
    "Resolution: 3840×1600",
    "Frame rate: 23.976 fps",
    "Video bitrate: 18400 kb/s",
    "Audio track: Japanese · opus · 2 ch · playing",
    "Subtitle track: English · Signs · ass",
  ]);
});

test("request ids read as what was asked", () => {
  expect(describeRequest("kitsu:12:5")).toBe("Kitsu 12, episode 5");
  expect(describeRequest("tt0000000")).toBe("IMDb tt0000000");
});

test("torrent sources show their hash and file", () => {
  const m = rows(stream({ stream: { infoHash: "0123456789abcdef0123456789abcdef01234567", fileIdx: 2, name: "Open Films" } }));
  expect(m.get("Info hash")).toBe("0123456789abcdef0123456789abcdef01234567");
  expect(m.get("File index")).toBe("2");
});
