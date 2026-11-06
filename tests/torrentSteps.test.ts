import { expect, test } from "bun:test";
import { describeTorrent, PEERS_KEY, torrentLimits } from "../src/lib/playback/torrent";
import { describeStream, formatReport, STAGE_LABEL } from "../src/lib/playback/startLog";

test("torrent steps read as plain lines", () => {
  expect(describeTorrent({ kind: "searching", trackers: 3, dht: true }).text).toBe("Looking for peers (the DHT and 3 trackers)");
  expect(describeTorrent({ kind: "searching", trackers: 1, dht: false }).text).toBe("Looking for peers (1 tracker)");
  expect(describeTorrent({ kind: "metadata", files: 5, chosen: 2, ext: "mkv", size: 1_400_000_000, ms: 1200 })).toEqual({
    text: "File list from peers in 1.2 s: file 2 of 5 (.mkv, 1.4 GB)",
    tone: "ok",
    stage: "peers",
  });
  expect(describeTorrent({ kind: "metadata", files: 1, chosen: 1, ext: null, size: 700_000_000, ms: 0 }).text).toBe("File list from peers: 700 MB");
});

test("peer lines replace each other and warn with nobody connected", () => {
  const busy = describeTorrent({ kind: "peers", connected: 12, connecting: 3, downBps: 2_100_000, have: 45_000_000, size: 1_400_000_000 });
  expect(busy).toEqual({ text: "12 peers connected · 3 connecting · 2.1 MB/s · 45 MB of 1.4 GB", tone: "info", stage: "peers", key: PEERS_KEY });
  const none = describeTorrent({ kind: "peers", connected: 0, connecting: 0, downBps: 0, have: 0, size: 10 });
  expect(none.tone).toBe("warn");
  expect(none.text).toStartWith("0 peers connected · 0 B/s");
});

test("a torrent source is named without its hash, and failures say where", () => {
  const stream = { infoHash: "0123456789abcdef0123456789abcdef01234567", fileIdx: 1, name: "Addon" };
  expect(describeStream(stream)).toBe("a torrent from your add-on (played by the built-in engine)");
  expect(STAGE_LABEL.peers).toBe("the torrent's peers");
  const report = formatReport([{ at: 10, text: "Looking for peers (the DHT)", tone: "info", stage: "peers" }], {
    app: "0.17.0",
    platform: "Windows",
    backend: "mpv",
    outcome: "No peers sent this torrent's file list within 60 s.",
    stage: "peers",
  });
  expect(report).toContain("(at the torrent's peers)");
  expect(report).not.toContain("0123456789abcdef");
});

test("limits go to the backend as set", () => {
  expect(torrentLimits({ torrentCacheGb: 20, torrentSpeedMbps: 0, torrentKeepSharing: false })).toEqual({ cacheGb: 20, speedMbps: 0, keepSharing: false });
});
