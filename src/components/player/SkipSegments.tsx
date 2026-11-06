import { useQuery } from "@tanstack/react-query";
import { SkipForward } from "../icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { aniSkipSegments } from "../../lib/anime";
import { withShortcut } from "../../lib/settings";
import { useHandFocus } from "../../lib/ui";
import type { SkipSegments, Span } from "../../lib/types";
import { isMpv, type MediaLike, type MpvChapter } from "./mpvMedia";
import { useMediaTime } from "./useMediaTime";
import { keys } from "../../lib/net";

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
  started,
  autoSkip,
  autoSkipDelay,
  media,
  preferFile,
  seekTo,
  onAutoSkipped,
  online: lookUp = true,
}: {
  videoId: string;
  started: boolean;
  /** Which segments to skip without asking (Settings → Playback). */
  autoSkip: { intro: boolean; recap: boolean };
  /** Seconds the skip button counts down before an auto-skip; 0 = at once. */
  autoSkipDelay: number;
  /** The playhead, and where the file's own chapters come from (mpv only). */
  media: MediaLike | null;
  /** Trust the file's chapter names over IntroDB where it has them. */
  preferFile: boolean;
  seekTo: (t: number) => void;
  onAutoSkipped: (label: string) => void;
  /** Ask IntroDB and AniSkip; off for a pasted link, which they can't know. */
  online?: boolean;
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
    enabled: lookUp,
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

  // Only which segment the playhead is in re-renders, not every time report.
  const kind = useMediaTime(media, (t) => activeKind(segments, t.current));
  const active = useMemo(() => (segments && kind ? skipFor(segments, kind) : null), [segments, kind]);
  const autoSkipped = useRef(new Set<string>());

  const skipTo = useCallback(
    (a: ActiveSkip | null) => {
      if (a) seekTo(a.span.end + 0.05);
    },
    [seekTo],
  );

  // Auto-skip intros and recaps (never credits: those lead into "Up next").
  // With a delay, the skip button counts down first (its fill) and the skip
  // lands when that runs out; pressing it, or leaving the segment, ends it.
  const skipIntro = autoSkip.intro;
  const skipRecap = autoSkip.recap;
  const [counting, setCounting] = useState<string | null>(null);
  const key = active ? `${active.kind}@${active.span.start}` : null;
  const autoLabel = active?.kind === "intro" ? "Intro skipped" : "Recap skipped";
  useEffect(() => {
    if (!started || !active || !key || active.kind === "credits") return;
    if (!(active.kind === "intro" ? skipIntro : skipRecap)) return;
    if (autoSkipped.current.has(key)) return;
    autoSkipped.current.add(key);
    if (autoSkipDelay > 0) return setCounting(key);
    skipTo(active);
    onAutoSkipped(autoLabel);
  }, [skipIntro, skipRecap, started, active, key, autoSkipDelay, autoLabel, skipTo, onAutoSkipped]);

  const countdown = key && counting === key ? autoSkipDelay : 0;
  const finishCountdown = useCallback(() => {
    if (!countdown) return;
    setCounting(null);
    skipTo(active);
    onAutoSkipped(autoLabel);
  }, [countdown, active, autoLabel, skipTo, onAutoSkipped]);

  return {
    segments,
    active,
    /** Seconds the button counts down before skipping on its own, or 0. */
    countdown,
    finishCountdown,
    skipActive: useCallback(() => {
      setCounting(null);
      skipTo(active);
    }, [skipTo, active]),
  };
}

/** IntroDB's answer without its empty slots, so they don't hide AniSkip's. */
function stripEmpty(s?: SkipSegments): Partial<SkipSegments> {
  if (!s) return {};
  return Object.fromEntries(Object.entries(s).filter(([, v]) => v != null)) as Partial<SkipSegments>;
}

const OPENING_NAME = /^(opening( credits| sequence| titles?)?|op\d*|title sequence|main titles?)$/i;
/** Only the intro when nothing is named as the opening: anime releases often call the cold open "Intro". */
const INTRO_NAME = /^intro(duction)?$/i;
const RECAP_NAME = /^(recap|previously( on)?\b.*)$/i;
const OUTRO_NAME = /^(outro|ending( credits)?|ed\d*|end credits|closing credits|credits)$/i;

/** Intro, recap and credits as the file itself labels them: a chapter runs until the next one starts. */
function segmentsFromChapters(chapters: MpvChapter[], duration: number): Partial<SkipSegments> {
  const out: Partial<SkipSegments> = {};
  let opening: Span | undefined;
  chapters.forEach((c, i) => {
    const name = c.title?.trim().replace(/^\d+[.)\s-]+/, "").trim();
    if (!name) return;
    const end = chapters[i + 1]?.time ?? (Number.isFinite(duration) ? duration : NaN);
    if (!(end > c.time)) return;
    const span = { start: c.time, end };
    if (OPENING_NAME.test(name)) opening ??= span;
    else if (INTRO_NAME.test(name)) out.intro ??= span;
    else if (RECAP_NAME.test(name)) out.recap ??= span;
    else if (OUTRO_NAME.test(name)) out.outro ??= span;
  });
  if (opening) out.intro = opening;
  return out;
}

/** Which segment the playhead at `t` is in, if one is worth skipping. */
function activeKind(s: SkipSegments | undefined, t: number): ActiveSkip["kind"] | null {
  if (!s) return null;
  const within = (sp?: Span | null) => !!sp && t >= sp.start && t < sp.end - MIN_LEFT;
  if (within(s.intro)) return "intro";
  if (within(s.recap)) return "recap";
  // Movie credits: only worth skipping when a post-credits scene waits after
  // them (series credits hand over to the "Up next" card instead).
  if (s.postCredits && within(s.outro)) return "credits";
  return null;
}

function skipFor(s: SkipSegments, kind: ActiveSkip["kind"]): ActiveSkip {
  if (kind === "intro") return { kind, label: "Skip Intro", span: s.intro! };
  if (kind === "recap") return { kind, label: "Skip Recap", span: s.recap! };
  return { kind, label: "Skip to Post-Credits Scene", span: { start: s.outro!.start, end: s.postCredits!.start } };
}

/** How long the skip button stays up on its own when a segment starts, controls hidden. */
export const SKIP_ALONE_MS = 6000;

/**
 * Netflix-pattern skip button: bottom-right, above the timeline. It shows when
 * the segment starts, so it can be hit without first waking the UI, then after
 * SKIP_ALONE_MS goes with the controls: hidden while they are, back when they
 * are (the skip key works either way). Enters with a short fade/rise; leaves
 * the same way (state indication, occasional → standard motion).
 */
export function SkipButton({
  active,
  onSkip,
  chromeVisible,
  countdown = 0,
  paused = false,
  onCountdownEnd,
  glyph,
}: {
  active: ActiveSkip | null;
  onSkip: () => void;
  chromeVisible: boolean;
  /** Seconds until it skips on its own: the button fills left to right meanwhile (0 = no countdown). */
  countdown?: number;
  /** Playback paused: the countdown holds where it is. */
  paused?: boolean;
  onCountdownEnd?: () => void;
  /** The controller button that skips (TV mode), shown in place of the icon. */
  glyph?: ReactNode;
}) {
  // Keep the last label while fading out, so text doesn't vanish mid-exit.
  const [shown, setShown] = useState<ActiveSkip | null>(active);
  useEffect(() => {
    if (active) setShown(active);
  }, [active]);
  // A new segment shows on its own for a while; after that only with the controls.
  const segment = active ? `${active.kind}@${active.span.start}` : null;
  const [alone, setAlone] = useState(segment);
  useEffect(() => {
    if (!segment) return;
    setAlone(segment);
    const t = setTimeout(() => setAlone(null), SKIP_ALONE_MS);
    return () => clearTimeout(t);
  }, [segment]);
  // A running countdown keeps it up: the skip it announces mustn't happen unseen.
  const visible = !!active && (chromeVisible || alone === segment || countdown > 0);
  // Skipped, ended or hidden with focus on it: focus goes back to the player, its keys keep working.
  const button = useRef<HTMLButtonElement>(null);
  useHandFocus(button, !visible);

  return (
    <button
      ref={button}
      className="skip-button"
      data-visible={visible}
      data-segment={!!active}
      data-chrome={chromeVisible}
      tabIndex={visible ? 0 : -1}
      inert={!visible}
      onClick={(e) => {
        e.stopPropagation();
        onSkip();
      }}
      title={withShortcut("Skip", "skip")}
    >
      {countdown > 0 && (
        // CSS times it (linear, holds while paused); its end is the skip. Keyed per
        // segment so a new countdown starts from empty.
        <span
          key={segment}
          className="skip-countdown"
          data-paused={paused}
          style={{ animationDuration: `${countdown}s` }}
          onAnimationEnd={onCountdownEnd}
          aria-hidden
        />
      )}
      {shown?.label ?? "Skip"}
      {glyph ?? <SkipForward size={18} fill="currentColor" strokeWidth={2.25} />}
    </button>
  );
}
