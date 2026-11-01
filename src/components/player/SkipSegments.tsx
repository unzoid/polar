import { useQuery } from "@tanstack/react-query";
import { SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { SkipSegments, Span } from "../../lib/types";

export interface ActiveSkip {
  kind: "intro" | "recap" | "credits";
  label: string;
  span: Span;
}

/** Don't offer a skip that would only save a moment. */
const MIN_LEFT = 2;

/**
 * IntroDB segments for the current video, the segment the playhead is in,
 * and (optionally) auto-skipping intros/recaps — once per segment, so seeking
 * back into an intro to rewatch it is respected.
 */
export function useSkipSegments({
  videoId,
  time,
  started,
  autoSkip,
  seekTo,
  onAutoSkipped,
}: {
  videoId: string;
  time: number;
  started: boolean;
  autoSkip: boolean;
  seekTo: (t: number) => void;
  onAutoSkipped: (label: string) => void;
}) {
  const { data: segments } = useQuery({
    queryKey: ["skip-segments", videoId],
    queryFn: () => api.skipSegments(videoId),
    staleTime: 60 * 60_000,
    retry: 1,
  });

  const active = activeSegment(segments, time);
  const autoSkipped = useRef(new Set<string>());

  const skipTo = useCallback(
    (a: ActiveSkip | null) => {
      if (a) seekTo(a.span.end + 0.05);
    },
    [seekTo],
  );

  // Auto-skip intros and recaps (never credits: those lead into "Up next").
  useEffect(() => {
    if (!autoSkip || !started || !active || active.kind === "credits") return;
    const key = `${active.kind}@${active.span.start}`;
    if (autoSkipped.current.has(key)) return;
    autoSkipped.current.add(key);
    skipTo(active);
    onAutoSkipped(active.kind === "intro" ? "Intro skipped" : "Recap skipped");
  }, [autoSkip, started, active, skipTo, onAutoSkipped]);

  return {
    segments,
    active,
    skipActive: useCallback(() => skipTo(active), [skipTo, active]),
  };
}

function activeSegment(s: SkipSegments | undefined, t: number): ActiveSkip | null {
  if (!s) return null;
  const within = (sp?: Span | null) => !!sp && t >= sp.start && t < sp.end - MIN_LEFT;
  if (within(s.intro)) return { kind: "intro", label: "Skip Intro", span: s.intro! };
  if (within(s.recap)) return { kind: "recap", label: "Skip Recap", span: s.recap! };
  // Movie credits: only worth skipping when a post-credits scene waits after
  // them (series credits hand over to the "Up next" card instead).
  if (s.postCredits && within(s.outro)) {
    return { kind: "credits", label: "Skip to Post-Credits Scene", span: { start: s.outro!.start, end: s.postCredits.start } };
  }
  return null;
}

/**
 * Netflix-pattern skip button: bottom-right, above the timeline, visible for
 * as long as the segment plays — independent of the auto-hiding controls, so
 * it can be hit without first waking the UI. Enters with a short fade/rise;
 * leaves the same way (state indication, occasional → standard motion).
 */
export function SkipButton({
  active,
  onSkip,
  chromeVisible,
}: {
  active: ActiveSkip | null;
  onSkip: () => void;
  chromeVisible: boolean;
}) {
  // Keep the last label while fading out, so text doesn't vanish mid-exit.
  const [shown, setShown] = useState<ActiveSkip | null>(active);
  useEffect(() => {
    if (active) setShown(active);
  }, [active]);

  return (
    <button
      className="skip-button"
      data-visible={!!active}
      data-chrome={chromeVisible}
      tabIndex={active ? 0 : -1}
      aria-hidden={!active}
      onClick={(e) => {
        e.stopPropagation();
        onSkip();
      }}
      title="Skip (S)"
    >
      {shown?.label ?? "Skip"}
      <SkipForward size={18} fill="currentColor" strokeWidth={2.25} />
    </button>
  );
}
