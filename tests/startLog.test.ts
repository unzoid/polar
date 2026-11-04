import { expect, test } from "bun:test";
import { describeProbe, describeStream, failedStage, formatBytes, formatReport, hostOf, redact, type StartStep } from "../src/lib/startLog";

test("links keep only their host", () => {
  expect(hostOf("https://addon.example.com/eyJrZXkiOiJzZWNyZXQifQ/stream/movie/tt1.json")).toBe("addon.example.com");
  expect(hostOf("https://user:pw@cdn.example.com:8443/a?token=x")).toBe("cdn.example.com:8443");
  expect(hostOf("http://192.168.1.20:8096/Videos/1/stream")).toBe("a device on your network");
  expect(hostOf("http://172.20.0.3/x")).toBe("a device on your network");
  expect(hostOf("http://[fd12::1]/x")).toBe("a device on your network");
  expect(hostOf("http://127.0.0.1:7878/sintel.mkv")).toBe("this computer");
  expect(hostOf("not a url")).toBe("a link");
});

test("redact removes paths, queries and home folders", () => {
  const text = redact("failed: https://cdn.example.com/u/12345/abcdef.mkv?sig=deadbeef at /home/alex/.config/x and C:\\Users\\Alex\\Videos");
  expect(text).toBe("failed: <cdn.example.com> at ~/.config/x and ~\\Videos");
  expect(text).not.toContain("sig=");
  expect(text).not.toContain("alex");
});

test("probe steps read as plain lines", () => {
  expect(describeProbe({ kind: "request", host: "cdn.example.com", attempt: 1 }).text).toBe("Contacting cdn.example.com");
  expect(describeProbe({ kind: "request", host: "h", attempt: 2 }).text).toBe("Asking h again (2nd try)");
  expect(describeProbe({ kind: "redirect", from: "a.com", to: "b.com", status: 302, ms: 120 }).text).toBe("302: sent on from a.com to b.com (120 ms)");
  const ok = describeProbe({
    kind: "response",
    host: "b.com",
    status: 206,
    reason: "Partial Content",
    contentType: "video/x-matroska",
    size: 3_700_000_000,
    ms: 1500,
  });
  expect(ok).toEqual({ text: "206 Partial Content from b.com · video/x-matroska · 3.7 GB · 1.5 s", tone: "ok", stage: "server" });
  expect(describeProbe({ kind: "response", host: "b.com", status: 403, reason: "Forbidden", ms: 80 }).tone).toBe("warn");
  expect(describeProbe({ kind: "retry", afterMs: 600 }).text).toBe("Link not ready yet, waiting 600 ms");
});

test("stream kinds", () => {
  expect(describeStream({ url: "https://cdn.example.com/a/Movie.2024.1080p.mkv" })).toBe("direct file (.mkv) on cdn.example.com");
  expect(describeStream({ url: "https://live.example.com/hls/master.m3u8?t=1" })).toBe("HLS stream on live.example.com");
  expect(describeStream({ url: "https://x.example.com/resolve/abc" })).toBe("direct link on x.example.com");
  expect(describeStream({ url: "/home/alex/Polarity/Downloads/film.mp4" })).toBe("a downloaded file");
  expect(describeStream({ ytId: "abc" })).toContain("YouTube");
});

test("bytes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(136_909)).toBe("137 KB");
  expect(formatBytes(4_000_000_000)).toBe("4.0 GB");
});

const steps: StartStep[] = [
  { at: 10, text: "Player: mpv", tone: "info", stage: "player" },
  { at: 900, text: "Found 12 sources from 2 add-ons", tone: "ok", stage: "sources" },
  { at: 950, text: "Source 1 of 5: 1080p · Example", tone: "info", stage: "link" },
  { at: 1300, text: "403 Forbidden from cdn.example.com · 80 ms", tone: "warn", stage: "server" },
  { at: 1310, text: "The source answered 403 Forbidden. Choose another source.", tone: "fail", stage: "server" },
  { at: 1320, text: "Trying the next source", tone: "warn" },
];

test("the failed stage is the last failed line's", () => {
  expect(failedStage(steps)).toBe("server");
  expect(failedStage(steps.slice(0, 2))).toBe("sources");
  expect(failedStage([])).toBeUndefined();
});

test("the copied report has every step, redacted", () => {
  const report = formatReport([...steps, { at: 2000, text: "see https://evil.example.com/key/abc", tone: "info" }], {
    app: "0.17.0",
    platform: "Linux",
    backend: "mpv",
    outcome: "None of the sources could be played.",
    stage: "server",
  });
  expect(report.split("\n")[0]).toBe("Polarity 0.17.0 · Linux · player: mpv");
  expect(report).toContain("Result: None of the sources could be played. (at the source's server)");
  expect(report).toContain("  +1.31s  ✗ The source answered 403 Forbidden.");
  expect(report).toContain("<evil.example.com>");
  expect(report).not.toContain("/key/abc");
});
