import { useQuery } from "@tanstack/react-query";
import { SkipForward } from "../icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { aniSkipSegments } from "../../lib/anime/aniskip";
import { withShortcut } from "../../lib/keybinds";
import type { SkipSegments, Span } from "../../lib/types";
import { isMpv, type MediaLike, type MpvChapter } from "./mpvMedia";
import { keys } from "../../lib/queryKeys";

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
  media,
  preferFile,
  seekTo,
  onAutoSkipped,
}: {
  videoId: string;
  time: number;
  started: boolean;
  /** Which segments to skip without asking (Settings → Playback). */
  autoSkip: { intro: boolean; recap: boolean };
  /** Where the file's own chapters come from (mpv only). */
  media: MediaLike | null;
  /** Trust the file's chapter names over IntroDB where it has them. */
  preferFile: boolean;
  seekTo: (t: number) => void;
  onAutoSkipped: (label: string) => void;
}) {
  const { data: online } = useQuery({
    queryKey: keys.skipSegments(videoId),
    queryFn: async () => {
      const introDb = await api.skipSegments(videoId).catch(() => undefined);
      // Anime: AniSkip fills whatever IntroDB doesn't know (it rarely knows anime).
      if (introDb?.intro && introDb?.outro) return introDb;
      const anime = await aniSkipSegments(videoId).catch(() => ({}));
      if (!introDb && !Object.keys(anime).length) throw new Error("No skip segments");
      return { intro: null, recap: null, outro: null, postCredits: null, ...anime, ...stripEmpty(introDb) } as SkipSegments;
    },
    staleTime: 60 * 60_000,
    retry: 1,
  });

  const [fromFile, setFromFile] = useState<Partial<SkipSegments>>({});
  useEffect(() => {
    if (!media || !isMpv(media)) {
      setFromFile({});
      return;
    }
    const sync = () => setFromFile(segmentsFromChapters(media.chapters, media.duration));
    sync();
    for (const e of ["chapters", "loadedmetadata", "durationchange"]) media.addEventListener(e, sync);
    return () => {
      for (const e of ["chapters", "loadedmetadata", "durationchange"]) media.removeEventListener(e, sync);
    };
  }, [media]);

  // The file wins where it has an answer; IntroDB fills the rest.
  const segments = useMemo<SkipSegments | undefined>(() => {
    if (!preferFile || !Object.keys(fromFile).length) return online;
    return { intro: null, recap: null, outro: null, postCredits: null, ...online, ...fromFile } as SkipSegments;
  }, [online, fromFile, preferFile]);

  const active = activeSegment(segments, time);
  const autoSkipped = useRef(new Set<string>());

  const skipTo = useCallback(
    (a: ActiveSkip | null) => {
      if (a) seekTo(a.span.end + 0.05);
    },
    [seekTo],
  );

  // Auto-skip intros and recaps (never credits: those lead into "Up next").
  const skipIntro = autoSkip.intro;
  const skipRecap = autoSkip.recap;
  useEffect(() => {
    if (!started || !active || active.kind === "credits") return;
    if (!(active.kind === "intro" ? skipIntro : skipRecap)) return;
    const key = `${active.kind}@${active.span.start}`;
    if (autoSkipped.current.has(key)) return;
    autoSkipped.current.add(key);
    skipTo(active);
    onAutoSkipped(active.kind === "intro" ? "Intro skipped" : "Recap skipped");
  }, [skipIntro, skipRecap, started, active, skipTo, onAutoSkipped]);

  return {
    segments,
    active,
    skipActive: useCallback(() => skipTo(active), [skipTo, active]),
  };
}

/** IntroDB's answer without its empty slots, so they don't hide AniSkip's. */
function stripEmpty(s?: SkipSegments): Partial<SkipSegments> {
  if (!s) return {};
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v != null)) as Partial<SkipSegments>;
}

const INTRO_NAME =/^(intro(duction)?|opening( credits| sequence| titles?)?|op\d*|title sequence|main titles?)$/i;
const RECAP_NAME = /^(recap|previously( on)?\b.*)$/i;
const OUTRO_NAME = /^(outro|ending( credits)?|ed\d*|end credits|closing credits|credits)$/i;

/** Intro, recap and credits as the file itself labels them: a chapter runs until the next one starts. */
function segmentsFromChapters(chapters: MpvChapter[], duration: number): Partial<SkipSegments> {
  const out: Partial<SkipSegments> = {};
  chapters.forEach((c, i) => {
    const name = c.title?.trim().replace(/^\d+[.)\s-]+/, "").trim();
    if (!name) return;
    const end = chapters[i + 1]?.time ?? (Number.isFinite(duration) ? duration : NaN);
    if (!(end > c.time)) return;
    const span = { start: c.time, end };
    if (!out.intro && INTRO_NAME.test(name)) out.intro = span;
    else if (!out.recap && RECAP_NAME.test(name)) out.recap = span;
    else if (!out.outro && OUTRO_NAME.test(name)) out.outro = span;
  });
  return out;
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
  glyph,
}: {
  active: ActiveSkip | null;
  onSkip: () => void;
  chromeVisible: boolean;
  /** The controller button that skips (TV mode), shown in place of the icon. */
  glyph?: ReactNode;
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
      title={withShortcut("Skip", "skip")}
    >
      {shown?.label ?? "Skip"}
      {glyph ?? <SkipForward size={18} fill="currentColor" strokeWidth={2.25} />}
    </button>
  );
}
