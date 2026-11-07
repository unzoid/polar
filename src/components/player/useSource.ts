import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { useMeta, useProgress, useStreams } from "../../lib/net";
import {
  autoPickOrder,
  describeStream,
  describeTorrent,
  recordFail,
  recordTry,
  torrentLimits,
  useMatchContext,
  useTitleSettings,
  type SourceKind,
  type TorrentStep,
} from "../../lib/playback";
import { runtimeSeconds } from "../../lib/format";
import { on } from "../../lib/platform";
import { getPrefs, setPrefs } from "../../lib/settings";
import type { ContentType, Playable, Progress, Stream } from "../../lib/types";
import { sameFile, type StreamHint } from "../../lib/party";
import { errorMessage } from "../../lib/errors";
import type { LogStep } from "./useStartLog";

export type SourceState =
  | { status: "searching" }
  | { status: "resolving"; stream: Stream; label?: string }
  /** A torrent source waits for the user to read the one-time notice (`answerNotice`). */
  | { status: "notice"; stream: Stream; label?: string }
  | { status: "ready"; stream: Stream; url: string; label?: string }
  | { status: "failed"; reason: string };

interface Candidate {
  stream: Stream;
  label?: string;
  addon?: string;
  /** Its release group, for what worked before (sourceHistory.ts). */
  group?: string | null;
}

let torrentSteps = 0;

/**
 * Decides what to play, with no user decision required:
 *   1. the stream explicitly picked in the source sheet, else
 *   2. in a watch party, the file the room is on (from your own add-ons), else
 *   3. the stream this video was last played with (resume = same file), else
 *   4. the top-ranked streams, in order.
 * The decision is frozen once made — saving progress mid-playback must never
 * re-trigger source selection. `next()` falls through after a playback error.
 * Each decision and attempt is written to `log` (the loading screen's steps).
 * A torrent source is opened by the backend's engine, whose steps are logged
 * too (peer counts until `started()` says the picture is up), and closed when
 * the player goes or falls through to the next source. The first torrent on a
 * device waits for the user's Play or Cancel in a notice first (Prefs.torrentNotice).
 * Each try of a ranked source, and each that fails to open, is kept for Best Match
 * (sourceHistory.ts); the player records whether it started and played through.
 */
export function useSource(
  type: ContentType,
  metaId: string,
  videoId: string,
  picked: Stream | undefined,
  prefer: StreamHint | undefined,
  log: LogStep,
  started: () => boolean = () => false,
) {
  const progress = useProgress(metaId);
  const [saved, setSaved] = useState<Progress | null | undefined>(undefined);
  useEffect(() => {
    if (saved === undefined && progress.data) setSaved(progress.data.find((p) => p.videoId === videoId) ?? null);
  }, [progress.data, saved, videoId]);

  const needsRanking = !picked && (!!prefer || (saved !== undefined && !saved?.stream));
  const streams = useStreams(type, needsRanking ? videoId : undefined);
  const { settings } = useTitleSettings(type, videoId);
  // Best Match for this device; the runtime gives the files' bitrates.
  const { data: meta } = useMeta(type, metaId, needsRanking);
  const match = useMatchContext(settings, runtimeSeconds(meta?.runtime));
  const matchRef = useRef(match);
  matchRef.current = match;
  useEffect(() => {
    if (needsRanking) log("Asking your add-ons for sources", "info", "sources");
  }, [needsRanking, log]);

  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  useEffect(() => {
    if (candidates) return;
    if (picked) {
      log("Using the source you picked", "info", "sources");
      return setCandidates([{ stream: picked }]);
    }
    if (!prefer) {
      if (saved === undefined) return;
      if (saved?.stream) {
        log("Resuming with the source this was last played from", "info", "sources");
        return setCandidates([{ stream: saved.stream }]);
      }
    }
    if (streams.data) {
      // Best match for this screen, narrowed by the filters you set in the player
      // for this show (next episode: the same kind of file), else by the source
      // preferences in Settings, when they leave something.
      const ranked = autoPickOrder(streams.data.streams, settings, metaId, matchRef.current);
      // The room's file first, even past Settings' filters: same file, same timing.
      const same = prefer ? streams.data.streams.find((r) => sameFile(r.stream, prefer)) : undefined;
      const { streams: all, failed, hidden = 0 } = streams.data;
      const addons = new Set(all.map((r) => r.addon)).size;
      const filtered = all.length - ranked.length + hidden;
      log(
        `Found ${all.length + hidden} source${all.length + hidden === 1 ? "" : "s"} from ${addons} add-on${addons === 1 ? "" : "s"}` +
          (filtered > 0 ? `; ${filtered} left out by your source filters` : ""),
        all.length ? "ok" : "warn",
        "sources",
      );
      if (failed.length) log(`No answer from: ${failed.join(", ")}`, "warn", "sources");
      const others = all.filter((r) => r.otherEpisode).length;
      if (others) log(`${others} of them ${others === 1 ? "is a file" : "are files"} of another episode, left for last and not tried`, "info", "sources");
      if (same) log("Using the watch party's file", "info", "sources");
      setCandidates(
        (same ? [same, ...ranked.filter((r) => r !== same)] : ranked)
          .slice(0, 5)
          .map((s) => ({ stream: s.stream, label: s.label, addon: s.addon, group: s.quality.source })),
      );
    } else if (streams.isError) {
      log(`Couldn't ask the add-ons: ${errorMessage(streams.error)}`, "fail", "sources");
      setCandidates([]);
    }
  }, [candidates, picked, prefer, saved, streams.data, streams.isError, streams.error, settings, metaId, log]);

  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SourceState>({ status: "searching" });
  const startedNow = useRef(started);
  startedNow.current = started;
  /** Settles the notice's wait: true = play, false = play nothing. */
  const noticeAnswer = useRef<((play: boolean) => void) | undefined>(undefined);

  useEffect(() => {
    if (!candidates) return;
    const candidate = candidates[attempt];
    if (!candidate) {
      const reason = candidates.length ? "None of the sources could be played." : "No sources found. Install a stream add-on in Settings.";
      // Out of sources: the attempts above say why; with none at all, it's the add-ons.
      if (!candidates.length) log(reason, "fail", "sources");
      setState({ status: "failed", reason });
      return;
    }
    let cancelled = false;
    const name = [candidate.label, candidate.addon].filter(Boolean).join(" · ");
    log(`Source ${attempt + 1} of ${candidates.length}${name ? `: ${name}` : ""}`, "info", "link");
    setState({ status: "resolving", ...candidate });
    recordTry(candidate);
    const fail = (reason: string) => {
      recordFail(candidate);
      log(reason, "fail", "link");
      setState({ status: "failed", reason });
    };
    let unlisten: Promise<() => void> | undefined;
    let torrent = false;
    const openTorrent = () => {
      const stepId = ++torrentSteps;
      unlisten = on<{ id: number; step: TorrentStep }>("player://torrent", (e) => {
        if (cancelled || e.id !== stepId || (e.step.kind === "peers" && startedNow.current())) return;
        const { text, tone, stage, key } = describeTorrent(e.step);
        log(text, tone, stage, key);
      });
      torrent = true;
      return api.torrentOpen(candidate.stream, torrentLimits(getPrefs()), stepId).then((t) => t.url);
    };
    api
      .resolveStream(candidate.stream)
      .then(async (p: Playable) => {
        if (cancelled) return;
        if (p.kind === "url") {
          log(`Link: ${describeStream(candidate.stream, p.url)}`, "info", "link");
          setState({ status: "ready", url: p.url, ...candidate });
        } else if (p.kind === "torrent") {
          if (getPrefs().torrentNotice) {
            setState({ status: "notice", ...candidate });
            const play = await new Promise<boolean>((resolve) => (noticeAnswer.current = resolve));
            noticeAnswer.current = undefined;
            if (cancelled || !play) return;
            setState({ status: "resolving", ...candidate });
          }
          log(`Link: ${describeStream(candidate.stream)}`, "info", "link");
          const url = await openTorrent();
          if (!cancelled) setState({ status: "ready", url, ...candidate });
        } else if (p.kind === "unsupported") fail(p.reason);
        else fail("This source opens outside the player.");
      })
      .catch((e) => !cancelled && fail(errorMessage(e)));
    return () => {
      cancelled = true;
      noticeAnswer.current?.(false);
      void unlisten?.then((f) => f());
      // The player closed or moved on to another source: this torrent stops (and its files go) unless the
      // user keeps sharing. One still opening gives up when it sees the close.
      if (torrent) void api.torrentClose(torrentLimits(getPrefs())).catch(() => {});
    };
  }, [candidates, attempt, log]);

  return {
    state,
    /**
     * The torrent notice's answer. Play turns the notice off on this device and goes on; Cancel opens
     * nothing (the player leaves).
     */
    answerNotice: (play: boolean) => {
      if (play) setPrefs({ torrentNotice: false });
      noticeAnswer.current?.(play);
    },
    /** Resume point captured when playback started. */
    resume: saved ?? undefined,
    /** The add-on and release group of the source being tried, when it came from the ranked list. */
    kind: (candidates?.[attempt] ?? {}) as SourceKind,
    /** Try the next candidate after a playback error. False if none left. */
    next: () => {
      if (!candidates || attempt + 1 >= candidates.length) return false;
      setAttempt((a) => a + 1);
      return true;
    },
  };
}
