import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useProgress, useSettings, useStreams } from "../../lib/queries";
import { autoPickOrder } from "../../lib/sources";
import type { ContentType, Playable, Progress, Stream } from "../../lib/types";
import { sameFile, type StreamHint } from "../../lib/party/party";
import { describeStream } from "../../lib/startLog";
import { errorMessage } from "../../lib/errors";
import type { LogStep } from "./useStartLog";

export type SourceState =
  | { status: "searching" }
  | { status: "resolving"; stream: Stream; label?: string }
  | { status: "ready"; stream: Stream; url: string; label?: string }
  | { status: "failed"; reason: string };

interface Candidate {
  stream: Stream;
  label?: string;
  addon?: string;
}

/**
 * Decides what to play, with no user decision required:
 *   1. the stream explicitly picked in the source sheet, else
 *   2. in a watch party, the file the room is on (from your own add-ons), else
 *   3. the stream this video was last played with (resume = same file), else
 *   4. the top-ranked streams, in order.
 * The decision is frozen once made — saving progress mid-playback must never
 * re-trigger source selection. `next()` falls through after a playback error.
 * Each decision and attempt is written to `log` (the loading screen's steps).
 */
export function useSource(type: ContentType, metaId: string, videoId: string, picked: Stream | undefined, prefer: StreamHint | undefined, log: LogStep) {
  const progress = useProgress(metaId);
  const [saved, setSaved] = useState<Progress | null | undefined>(undefined);
  useEffect(() => {
    if (saved === undefined && progress.data) setSaved(progress.data.find((p) => p.videoId === videoId) ?? null);
  }, [progress.data, saved, videoId]);

  const needsRanking = !picked && (!!prefer || (saved !== undefined && !saved?.stream));
  const streams = useStreams(type, needsRanking ? videoId : undefined);
  const { data: settings } = useSettings();
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
      const ranked = autoPickOrder(streams.data.streams, settings, metaId);
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
      if (same) log("Using the watch party's file", "info", "sources");
      setCandidates(
        (same ? [same, ...ranked.filter((r) => r !== same)] : ranked)
          .slice(0, 5)
          .map((s) => ({ stream: s.stream, label: s.label, addon: s.addon })),
      );
    } else if (streams.isError) {
      log(`Couldn't ask the add-ons: ${errorMessage(streams.error)}`, "fail", "sources");
      setCandidates([]);
    }
  }, [candidates, picked, prefer, saved, streams.data, streams.isError, streams.error, settings, metaId, log]);

  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SourceState>({ status: "searching" });

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
    const fail = (reason: string) => {
      log(reason, "fail", "link");
      setState({ status: "failed", reason });
    };
    api
      .resolveStream(candidate.stream)
      .then((p: Playable) => {
        if (cancelled) return;
        if (p.kind === "url") {
          log(`Link: ${describeStream(candidate.stream, p.url)}`, "info", "link");
          setState({ status: "ready", url: p.url, ...candidate });
        } else if (p.kind === "unsupported") fail(p.reason);
        else fail("This source opens outside the player.");
      })
      .catch((e) => !cancelled && fail(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [candidates, attempt, log]);

  return {
    state,
    /** Resume point captured when playback started. */
    resume: saved ?? undefined,
    /** Try the next candidate after a playback error. False if none left. */
    next: () => {
      if (!candidates || attempt + 1 >= candidates.length) return false;
      setAttempt((a) => a + 1);
      return true;
    },
  };
}
