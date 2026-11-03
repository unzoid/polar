import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useProgress, useSettings, useStreams } from "../../lib/queries";
import { autoPickOrder } from "../../lib/sources";
import type { ContentType, Playable, Progress, Stream } from "../../lib/types";
import { sameFile, type StreamHint } from "../../lib/party/party";

export type SourceState =
  | { status: "searching" }
  | { status: "resolving"; stream: Stream; label?: string }
  | { status: "ready"; stream: Stream; url: string; label?: string }
  | { status: "failed"; reason: string };

interface Candidate {
  stream: Stream;
  label?: string;
}

/**
 * Decides what to play, with no user decision required:
 *   1. the stream explicitly picked in the source sheet, else
 *   2. in a watch party, the file the room is on (from your own add-ons), else
 *   3. the stream this video was last played with (resume = same file), else
 *   4. the top-ranked streams, in order.
 * The decision is frozen once made — saving progress mid-playback must never
 * re-trigger source selection. `next()` falls through after a playback error.
 */
export function useSource(type: ContentType, metaId: string, videoId: string, picked?: Stream, prefer?: StreamHint) {
  const progress = useProgress(metaId);
  const [saved, setSaved] = useState<Progress | null | undefined>(undefined);
  useEffect(() => {
    if (saved === undefined && progress.data) setSaved(progress.data.find((p) => p.videoId === videoId) ?? null);
  }, [progress.data, saved, videoId]);

  const needsRanking = !picked && (!!prefer || (saved !== undefined && !saved?.stream));
  const streams = useStreams(type, needsRanking ? videoId : undefined);
  const { data: settings } = useSettings();

  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  useEffect(() => {
    if (candidates) return;
    if (picked) return setCandidates([{ stream: picked }]);
    if (!prefer) {
      if (saved === undefined) return;
      if (saved?.stream) return setCandidates([{ stream: saved.stream }]);
    }
    if (streams.data) {
      // Best match for this screen, narrowed by the source preferences in Settings when they leave something.
      const ranked = autoPickOrder(streams.data.streams, settings);
      // The room's file first, even past Settings' filters: same file, same timing.
      const same = prefer ? streams.data.streams.find((r) => sameFile(r.stream, prefer)) : undefined;
      setCandidates(
        (same ? [same, ...ranked.filter((r) => r !== same)] : ranked)
          .slice(0, 5)
          .map((s) => ({ stream: s.stream, label: s.label })),
      );
    } else if (streams.isError) {
      setCandidates([]);
    }
  }, [candidates, picked, prefer, saved, streams.data, streams.isError, settings]);

  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SourceState>({ status: "searching" });

  useEffect(() => {
    if (!candidates) return;
    const candidate = candidates[attempt];
    if (!candidate) {
      setState({
        status: "failed",
        reason: candidates.length
          ? "None of the sources could be played."
          : "No sources found. Install a stream add-on in Settings.",
      });
      return;
    }
    let cancelled = false;
    setState({ status: "resolving", ...candidate });
    api
      .resolveStream(candidate.stream)
      .then((p: Playable) => {
        if (cancelled) return;
        if (p.kind === "url") setState({ status: "ready", url: p.url, ...candidate });
        else if (p.kind === "unsupported") setState({ status: "failed", reason: p.reason });
        else setState({ status: "failed", reason: "This source opens outside the player." });
      })
      .catch((e) => !cancelled && setState({ status: "failed", reason: String(e) }));
    return () => {
      cancelled = true;
    };
  }, [candidates, attempt]);

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
