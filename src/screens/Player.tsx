import { useQuery } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowLeft,
  Captions,
  Close,
  Episodes,
  ExitFullscreen,
  Fullscreen,
  Instant,
  Pause,
  Play,
  Settings as Cog,
  SkipForward,
  Sources,
  Speed,
  Volume,
  VolumeMuted,
} from "../components/icons";
import { AnimatePresence, motion } from "motion/react";
import { ease } from "../lib/motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Img } from "../components/Img";
import { Spinner } from "../components/Spinner";
import { streamKey } from "../components/StreamList";
import { SourceFilterBar } from "../components/SourceFilters";
import { sourceRow, useSourceFilters } from "../lib/sources";
import { isLocalFile } from "../lib/downloads";
import { WindowControls } from "../components/WindowControls";
import { Scrubber } from "../components/player/Scrubber";
import { useSource } from "../components/player/useSource";
import { SkipButton, useSkipSegments } from "../components/player/SkipSegments";
import { OptionsOverlay, type OptionItem } from "../components/player/OptionsOverlay";
import { SkipIcon } from "../components/player/icons";
import { useTracks } from "../components/player/useTracks";
import {
  DEFAULT_SUBTITLE_STYLE,
  SubtitlePreview,
  SubtitleSettings,
  applySubtitleStyleToMpv,
  forgetAssOverride,
  subtitleCueVars,
} from "../components/player/SubtitleSettings";
import { MpvMedia, type MediaLike } from "../components/player/mpvMedia";
import { usePrefs } from "../lib/prefs";
import { actionFor, withShortcut } from "../lib/keybinds";
import { api } from "../lib/api";
import { sync } from "../lib/account/sync";
import { nextVideo, progressMap, seasonsOf } from "../lib/episodes";
import { episodeCode, formatDate, formatRemaining, formatTime, isReleased, seasonLabel } from "../lib/format";
import { keys, prefetchStreams, queryClient, useMeta, useProgress, useSettings, useStreams, useUpdateSettings } from "../lib/queries";
import { useRouter } from "../lib/router";
import type { ContentType, Progress, Stream, Video } from "../lib/types";
import { isFiller } from "../lib/anime/filler";
import { isMac } from "../lib/platform";
import { watchedFraction } from "../lib/watched";
import { useMpvTune } from "../components/player/useMpvTune";
import { useTvMode } from "../tv/tvMode";
import { usePadGlyph } from "../tv/TvChrome";

const win = getCurrentWindow();
const SAVE_EVERY = 5000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** How long the player layer takes to fade back to the page (matches player.css). */
export const PLAYER_EXIT_MS = 260;
/** With "Up next" set to the very end, it appears this many seconds before. */
const NEXT_UP_AT_END = 12;

/**
 * Episodes autoplayed in a row with nobody touching anything, for "Still
 * watching?". Module-level: each episode is a fresh Player.
 */
let autoplayStreak = 0;

const TIME_DISPLAYS = ["remaining", "elapsed", "endsAt"] as const;
const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function Player({
  type,
  metaId,
  videoId,
  stream,
  leaving = false,
}: {
  type: ContentType;
  metaId: string;
  videoId: string;
  stream?: Stream;
  /** Route already popped; only the exit fade is left. Ignore input. */
  leaving?: boolean;
}) {
  const { back, replace } = useRouter();
  // TV mode keeps the window fullscreen: no fullscreen toggle, and Esc simply goes back.
  const tv = useTvMode();
  // With a controller in TV mode, controls show the button that triggers them.
  const pad = usePadGlyph(tv);
  const { data: meta } = useMeta(type, metaId);
  const { data: settings } = useSettings();
  // Engine: embedded mpv when installed (plays HEVC/MKV, AC3/DTS audio, every
  // subtitle format), else the WebView's own <video>.
  const engineQuery = useQuery({ queryKey: ["mpv"], queryFn: api.mpvAvailable, staleTime: Infinity });
  const engine: "mpv" | "html" | null = engineQuery.isFetched ? (engineQuery.data ? "mpv" : "html") : null;
  const mpv = useMemo(() => new MpvMedia(), []);
  const source = useSource(type, metaId, videoId, stream);

  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const media: MediaLike | null = engine === "mpv" ? mpv : videoEl;
  const videoRef = useRef<MediaLike | null>(null);
  videoRef.current = media;
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const [buffering, setBuffering] = useState(true);
  // Until the first frame actually plays, the loading screen stays up.
  const [started, setStarted] = useState(false);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("polar.volume") ?? 1));
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [options, setOptions] = useState<"speed" | "tracks" | "episodes" | "sources" | null>(null);
  const updateSettings = useUpdateSettings();
  // Settings → Playback → "Remember playback speed".
  const [rate, setRateState] = useState(() => (settings?.rememberSpeed && settings.playbackSpeed > 0 ? settings.playbackSpeed : 1));
  const setRate = (r: number) => {
    setRateState(r);
    if (settings?.rememberSpeed) updateSettings.mutate({ playbackSpeed: r });
  };
  const seekStep = settings?.seekStep ?? 10;
  const hideAfter = Math.max(1, settings?.controlsHideSecs ?? 2) * 1000;
  const countdown = Math.max(3, settings?.autoplayCountdown ?? 8);
  const timeDisplay = settings?.timeDisplay ?? "remaining";
  useMpvTune(engine === "mpv" ? mpv : null);
  // Subtitle look (saved) and timing offset (this video only).
  const subStyle = settings?.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;
  const [subDelay, setSubDelay] = useState(0);
  const [subSettingsOpen, setSubSettingsOpen] = useState(false);

  const tracks = useTracks(
    media,
    type,
    videoId,
    {
      audio: settings?.audioLanguage ?? "",
      subtitle: settings?.subtitleLanguage ?? "",
      subtitleMode: settings?.subtitleMode ?? "always",
    },
    (patch) => updateSettings.mutate(patch),
  );
  useEffect(() => {
    if (engine !== "mpv") return;
    applySubtitleStyleToMpv(mpv, subStyle, subDelay);
    // mpv may (re)start with the file; apply again once it's loaded.
    const onTracks = () => applySubtitleStyleToMpv(mpv, subStyle, subDelay);
    const onLoaded = () => {
      forgetAssOverride(mpv);
      onTracks();
    };
    mpv.addEventListener("loadedmetadata", onLoaded);
    // The track list (and which subtitle is on) arrives after the file opens:
    // an ASS track is only known to need its styling overridden once it's in.
    mpv.addEventListener("tracks", onTracks);
    return () => {
      mpv.removeEventListener("loadedmetadata", onLoaded);
      mpv.removeEventListener("tracks", onTracks);
    };
  }, [engine, mpv, subStyle, subDelay, tracks.subId]); // ASS tracks are restyled differently from plain text

  // Optional seek-bar thumbnails (Seekr). Keyed to whole seconds of duration:
  // the API aligns cues to the length of the release being played.
  const durationS = Math.round(time.duration || 0);
  const { data: seekTrack } = useQuery({
    queryKey: ["seekr", videoId, durationS],
    queryFn: () => api.seekPreviews(videoId, durationS * 1000),
    enabled: !!settings?.seekPreviews && !!settings?.seekrKey && durationS > 0,
    staleTime: Infinity,
    retry: false,
  });

  // --- Chrome visibility --------------------------------------------------
  const [chrome, setChrome] = useState({ visible: true, instant: false });
  const hideTimer = useRef<number>(undefined);
  const overControls = useRef(false);
  const poke = useCallback((instant = false) => {
    setChrome({ visible: true, instant });
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!overControls.current) setChrome({ visible: false, instant: false });
    }, hideAfter);
  }, [hideAfter]);
  // Leaving the window (alt-tab, another app, the cursor off the edge) hides it
  // now: nothing is pointing at the controls any more, so don't wait out the timer.
  useEffect(() => {
    const hide = () => {
      window.clearTimeout(hideTimer.current);
      overControls.current = false;
      setChrome({ visible: false, instant: false });
    };
    const onVisibility = () => document.hidden && hide();
    const root = document.documentElement;
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", onVisibility);
    root.addEventListener("mouseleave", hide);
    const unlisten = win.onFocusChanged(({ payload: focused }) => !focused && hide());
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", onVisibility);
      root.removeEventListener("mouseleave", hide);
      void unlisten.then((f) => f());
    };
  }, []);
  const ready = source.state.status === "ready" && !error;
  const chromeVisible = chrome.visible || paused || !!options || !ready;

  // --- Current / next episode ---------------------------------------------
  const current = meta?.videos.find((v) => v.id === videoId);
  const { animeSkipFiller } = usePrefs();
  // With "Skip filler" on, the next episode that isn't filler; `skipped` says how many were passed over.
  const { next, skipped } = useMemo(() => {
    let n = meta && type === "series" ? nextVideo(meta, videoId) : undefined;
    const skipped: Video[] = [];
    while (n && animeSkipFiller && isFiller(n.id) && meta) {
      skipped.push(n);
      n = nextVideo(meta, n.id);
    }
    return { next: n, skipped };
  }, [meta, type, videoId, animeSkipFiller]);
  const title = meta?.name ?? "";
  const heading = current ? `${episodeCode(current.season, current.episode)} · ${current.title}` : title;

  // --- Progress -------------------------------------------------------------
  const lastSave = useRef(0);
  const save = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration || !Number.isFinite(v.duration) || !meta || source.state.status !== "ready") return;
    lastSave.current = Date.now();
    const p: Progress = {
      metaId,
      videoId,
      type,
      name: meta.name,
      background: meta.background,
      poster: meta.poster,
      season: current?.season,
      episode: current?.episode,
      episodeTitle: current?.title,
      // A download plays from a file that may be deleted later: resuming
      // from Continue Watching picks an online source instead.
      stream: isLocalFile(source.state.stream?.url) ? undefined : source.state.stream,
      position: v.currentTime,
      duration: v.duration,
      updatedAt: 0,
    };
    api.saveProgress(p).then(sync.schedule, () => {});
  }, [meta, metaId, videoId, type, current, source.state]);

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(
    () => () => {
      saveRef.current();
      queryClient.invalidateQueries({ queryKey: keys.progress(metaId) });
      queryClient.invalidateQueries({ queryKey: keys.continue });
      queryClient.invalidateQueries({ queryKey: keys.history });
    },
    [metaId],
  );

  // --- mpv lifecycle ----------------------------------------------------------
  useEffect(() => {
    if (engine !== "mpv") return;
    let alive = true;
    let dispose: (() => void) | undefined;
    void mpv.attach().then((d) => {
      if (alive) dispose = d;
      else d(); // this mount is already gone; drop only its own listeners
    });
    return () => {
      alive = false;
      dispose?.();
      mpv.stop();
    };
  }, [engine, mpv]);

  // mpv draws in the native window *under* the page, so the page must be
  // see-through — but only once mpv has a picture. Until then the player is
  // an opaque black layer, so neither the page nor mpv's idle window shows.
  // Layout effect: the page turns clear (and back) in the same frame the
  // player does, never one frame apart.
  const seeThrough = engine === "mpv" && started;
  useLayoutEffect(() => {
    if (!seeThrough) return;
    document.documentElement.dataset.player = "mpv";
    return () => {
      delete document.documentElement.dataset.player;
    };
  }, [seeThrough]);

  // --- Load source ----------------------------------------------------------
  /** Where to pick up (Settings → Playback: resume on/off, rewind), or undefined to start over. */
  const resumePoint = (r?: Progress) => {
    if (settings?.resumePlayback === false || !r || r.position <= 30 || r.position / r.duration >= watchedFraction()) return undefined;
    return Math.max(0, r.position - (settings?.resumeRewind ?? 0));
  };
  const resumed = useRef(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || source.state.status !== "ready") return;
    resumed.current = false;
    setError(null);
    setBuffering(true);
    v.volume = volume;
    if (v instanceof MpvMedia) {
      // Start at the resume point directly: no fetching the opening of a
      // network stream only to seek away from it.
      const start = resumePoint(source.resume);
      resumed.current = true;
      v.load(source.state.url, start);
    } else if (v instanceof HTMLVideoElement) {
      v.src = source.state.url;
      v.play().catch(() => setPaused(true));
    }
    // Volume is applied by its own effect; only a new source reloads.
  }, [source.state, media]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
    localStorage.setItem("polar.volume", String(volume));
  }, [volume, muted, media]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate, source.state, media]);

  // Fullscreen carries over from the previous episode; Settings → Playback
  // can also start every video in it.
  const fullscreenApplied = useRef(false);
  useEffect(() => {
    if (!settings || fullscreenApplied.current) return;
    fullscreenApplied.current = true;
    void win.isFullscreen().then((fs) => {
      if (!fs && settings.startFullscreen && !tv) {
        void win.setFullscreen(true);
        setFullscreen(true);
      } else setFullscreen(fs);
    });
  }, [settings, tv]);

  // Settings → Playback → "Pause when minimized".
  const { pauseOnMinimize } = usePrefs();
  useEffect(() => {
    if (!pauseOnMinimize) return;
    const unlisten = win.onResized(() => {
      void win.isMinimized().then((min) => {
        if (min && videoRef.current && !videoRef.current.paused) videoRef.current.pause();
      });
    });
    return () => void unlisten.then((f) => f());
  }, [pauseOnMinimize]);

  // Any deliberate input means someone's still there ("Still watching?").
  useEffect(() => {
    const reset = () => (autoplayStreak = 0);
    window.addEventListener("keydown", reset);
    window.addEventListener("pointerdown", reset);
    window.addEventListener("wheel", reset);
    return () => {
      window.removeEventListener("keydown", reset);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("wheel", reset);
    };
  }, []);

  // --- Media events (identical for <video> and mpv) ---------------------------
  const handlers = {
    play: () => {
      setPaused(false);
      setEnded(false);
      poke();
    },
    pause: () => {
      setPaused(true);
      save();
    },
    waiting: () => setBuffering(true),
    playing: () => {
      setBuffering(false);
      setStarted(true);
    },
    canplay: () => setBuffering(false),
    loadedmetadata: () => {
      const v = videoRef.current!;
      const start = resumePoint(source.resume);
      if (!resumed.current && start != null) v.currentTime = start;
      resumed.current = true;
      setTime({ current: v.currentTime, duration: v.duration });
    },
    timeupdate: () => {
      const v = videoRef.current!;
      setTime({ current: v.currentTime, duration: v.duration || 0 });
      if (!v.paused) setStarted(true);
      if (Date.now() - lastSave.current > SAVE_EVERY && !v.paused) save();
    },
    ended: () => {
      setEnded(true);
      save();
    },
    error: () => {
      // mpv exiting isn't this source's fault: moving on to the next source
      // would just start mpv again (and if it keeps exiting, loop through
      // every source).
      const exited = videoRef.current instanceof MpvMedia && videoRef.current.error?.playerExited;
      if (!exited && source.next()) {
        setNotice("That source didn't load. Trying the next best one.");
        window.setTimeout(() => setNotice(null), 3500);
      } else {
        const v = videoRef.current;
        setError(
          v instanceof MpvMedia
            ? (v.error?.message ?? "This file couldn't be played.")
            : isMac
              ? "This file's format needs mpv. Install it (brew install mpv) and Polarity will play it."
              : "This file's format needs mpv. Install mpv and Polarity will play it.",
        );
      }
    },
  };
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    if (!media) return;
    const names = Object.keys(handlersRef.current) as (keyof typeof handlers)[];
    const bound = names.map((n) => [n, () => handlersRef.current[n]()] as const);
    bound.forEach(([n, fn]) => media.addEventListener(n, fn));
    return () => bound.forEach(([n, fn]) => media.removeEventListener(n, fn));
  }, [media]);

  // --- Actions ----------------------------------------------------------------
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (v?.duration) v.currentTime = Math.min(v.duration - 1, Math.max(0, v.currentTime + delta));
  }, []);

  const { preferFileChapters } = usePrefs();
  const skip = useSkipSegments({
    videoId,
    time: time.current,
    started,
    autoSkip: { intro: !!settings?.autoSkip, recap: settings?.autoSkipRecaps ?? !!settings?.autoSkip },
    media,
    preferFile: preferFileChapters,
    seekTo: (t) => {
      if (videoRef.current) videoRef.current.currentTime = t;
    },
    onAutoSkipped: (label) => {
      setNotice(label);
      window.setTimeout(() => setNotice(null), 2500);
    },
  });

  const toggleFullscreen = useCallback(async () => {
    if (tv) return;
    const next = !(await win.isFullscreen());
    await win.setFullscreen(next);
    setFullscreen(next);
  }, [tv]);

  // Fade back to the page first, *then* leave fullscreen: resizing the window
  // while mpv's native picture is up is what flickers, so do it once the page
  // is opaque on top.
  const exit = useCallback(async () => {
    const fs = !tv && (await win.isFullscreen());
    back();
    if (fs) window.setTimeout(() => void win.setFullscreen(false), PLAYER_EXIT_MS);
  }, [back, tv]);

  const playVideo = useCallback(
    (id: string, s?: Stream) => {
      save();
      replace({ name: "player", type, metaId, videoId: id, stream: s });
    },
    [save, replace, type, metaId],
  );

  // --- Episodes & sources pickers -------------------------------------------
  const { data: progress } = useProgress(metaId);
  const progressById = useMemo(() => progressMap(progress), [progress]);
  const seasons = useMemo(() => (meta ? seasonsOf(meta) : []), [meta]);
  const [pickSeason, setPickSeason] = useState<number>();
  const shownSeason = pickSeason ?? current?.season ?? seasons[0];
  // Only fetched once the Sources picker is opened (and usually cached already).
  const streams = useStreams(type, options === "sources" ? videoId : undefined);

  const episodeItems: OptionItem[] = (meta?.videos ?? [])
    .filter((v) => v.season === shownSeason)
    .map((v) => {
      const p = progressById.get(v.id);
      const fraction = p?.duration ? p.position / p.duration : 0;
      const released = isReleased(v);
      return {
        id: v.id,
        label: `${v.episode}. ${v.title}`,
        detail: !released
          ? `Coming ${formatDate(v.released)}`
          : fraction > 0 && fraction < watchedFraction() && p
            ? formatRemaining(p.position, p.duration)
            : formatDate(v.released),
        thumbnail: v.thumbnail ?? "",
        progress: fraction < watchedFraction() ? fraction : undefined,
        badge: fraction >= watchedFraction() ? { text: "Watched" } : undefined,
        disabled: !released,
      };
    });

  const rankedStreams = streams.data?.streams ?? [];
  const currentKey = source.state.status === "ready" ? streamKey(source.state) : undefined;
  // Filter (add-on, resolution, language, size, tags) and sort, as on the
  // title page. Ids stay the index into the ranked list, so selection works
  // regardless of the view.
  const sourceFilters = useSourceFilters(streams.data?.streams, settings);
  const hiddenSources = streams.data?.hidden ?? 0;
  const sourceItems: OptionItem[] = sourceFilters.view.map(({ r }, n) => {
    const row = sourceRow(r);
    return {
      id: String(rankedStreams.indexOf(r)),
      label: n === 0 && sourceFilters.sort === "best" ? `${row.title} · Best Match` : row.title,
      detail: [row.size, row.detail].filter(Boolean).join(" · "),
      badge: r.quality.lowQualitySource
        ? { text: "CAM", tone: "bad" as const }
        : r.quality.cached
          ? { text: "Instant", tone: "good" as const, icon: <Instant size={14} fill="currentColor" strokeWidth={0} /> }
          : undefined,
    };
  });
  const currentSourceIndex = rankedStreams.findIndex((r) => streamKey(r) === currentKey);

  // --- Keyboard: instant, never animated -------------------------------------
  useEffect(() => {
    if (leaving) return; // the page underneath has the keyboard already
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      // A dropdown has the keyboard while it's focused or open (arrows, Space, Esc are its own).
      if ((e.target as HTMLElement).closest?.("[aria-haspopup=listbox], [role=listbox], .srcf-popover")) return;
      const handled = (() => {
        // Shortcuts are rebindable (Settings → Controls); Esc always backs out.
        switch (e.key === "Escape" ? "escape" : actionFor(e, "player")) {
          case "playPause":
            togglePlay();
            return true;
          case "seekBack":
            seekBy(-seekStep);
            return true;
          case "seekForward":
            seekBy(seekStep);
            return true;
          case "volumeUp":
            setVolume((v) => Math.min(1, +(v + 0.1).toFixed(2)));
            setMuted(false);
            return true;
          case "volumeDown":
            setVolume((v) => Math.max(0, +(v - 0.1).toFixed(2)));
            return true;
          case "mute":
            setMuted((m) => !m);
            return true;
          case "fullscreen":
            void toggleFullscreen();
            return true;
          case "skip":
            skip.skipActive();
            return true;
          case "nextEpisode":
            if (next) playVideo(next.id);
            return true;
          case "tracks":
            setOptions((o) => (o === "tracks" ? null : "tracks"));
            return true;
          case "episodes":
            if (type !== "series") return false;
            setOptions((o) => (o === "episodes" ? null : "episodes"));
            return true;
          case "sources":
            setOptions((o) => (o === "sources" ? null : "sources"));
            return true;
          case "speed":
            setOptions((o) => (o === "speed" ? null : "speed"));
            return true;
          case "escape":
            if (tv) {
              void exit();
              return true;
            }
            // Leave fullscreen first; a second Esc backs out of the player.
            void win.isFullscreen().then((fs) => {
              if (fs) {
                void win.setFullscreen(false);
                setFullscreen(false);
              } else {
                void exit();
              }
            });
            return true;
        }
        return false;
      })();
      if (handled) {
        e.preventDefault();
        poke(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leaving, togglePlay, seekBy, seekStep, toggleFullscreen, exit, next, playVideo, poke, skip, tv, type]);

  // Warm the next episode's sources well before the credits.
  const prefetchedNext = useRef(false);
  useEffect(() => {
    if (next && !prefetchedNext.current && time.duration && time.current / time.duration > 0.75) {
      prefetchedNext.current = true;
      prefetchStreams(type, next.id);
    }
  }, [next, time, type]);

  // Autoplay countdown once the episode ends, unless it's time to ask
  // whether anyone's still watching (Settings → Playback).
  const askAfter = settings?.stillWatchingAfter ?? 0;
  const stillWatching = askAfter > 0 && autoplayStreak >= askAfter;
  const willAutoplay = !!settings?.autoplayNext && !stillWatching;
  useEffect(() => {
    if (!ended || !next || nextDismissed || !willAutoplay) return;
    const t = window.setTimeout(() => {
      autoplayStreak += 1;
      playVideo(next.id);
    }, countdown * 1000);
    return () => window.clearTimeout(t);
  }, [ended, next, nextDismissed, willAutoplay, countdown, playVideo]);

  const remaining = time.duration - time.current;
  // With IntroDB credit timings, "Up next" arrives exactly when the credits
  // roll (Netflix-style); without them, fall back to the last ~40s. Settings
  // can hold it back until the very end instead.
  const creditsStart = skip.segments?.outro?.start;
  const inCredits =
    creditsStart != null && time.current >= creditsStart && !skip.segments?.postCredits;
  const atEnd = settings?.nextUpTiming === "end";
  const showNextUp =
    !!next &&
    !nextDismissed &&
    time.duration > 0 &&
    (ended ||
      (atEnd
        ? remaining <= NEXT_UP_AT_END
        : inCredits || (creditsStart == null && remaining <= Math.max(40, time.duration * 0.04))));

  // The timeline clock (Settings → Playback; clicking it cycles).
  const clockText =
    timeDisplay === "elapsed"
      ? `${formatTime(time.current)} / ${formatTime(time.duration)}`
      : timeDisplay === "endsAt"
        ? `Ends at ${clock.format(Date.now() + (remaining / (rate || 1)) * 1000)}`
        : formatTime(remaining);
  const cycleClock = () =>
    updateSettings.mutate({ timeDisplay: TIME_DISPLAYS[(TIME_DISPLAYS.indexOf(timeDisplay) + 1) % TIME_DISPLAYS.length] });

  const VolumeIcon = muted || volume === 0 ? VolumeMuted : Volume;

  return (
    <div
      className="player"
      data-engine={engine ?? undefined}
      data-buffering={buffering && ready}
      data-chrome={chromeVisible}
      data-instant={chrome.instant}
      data-options={!!options}
      data-started={started}
      onPointerMove={() => poke()}
      onPointerDown={() => poke()}
    >
      {engine === "html" && (
        <video ref={setVideoEl} className="player-video" playsInline style={subtitleCueVars(subStyle)} />
      )}
      {/* Click target over either engine: tap to play/pause, double-click for
          fullscreen, wheel for volume. */}
      <div
        className="player-surface"
        // Respond immediately; double-click adds fullscreen on top. Settings
        // can make a click only show/hide the controls instead.
        onClick={() => {
          if (settings?.clickAction !== "controls") return togglePlay();
          if (chrome.visible) setChrome({ visible: false, instant: false });
          else poke();
        }}
        onDoubleClick={() => void toggleFullscreen()}
        onWheel={(e) => {
          const wheel = settings?.wheelAction ?? "volume";
          if (wheel === "none") return;
          if (wheel === "seek") seekBy(-Math.sign(e.deltaY) * seekStep);
          else {
            setVolume((v) => Math.min(1, Math.max(0, +(v - Math.sign(e.deltaY) * 0.05).toFixed(2))));
            setMuted(false);
          }
          poke(true);
        }}
      />

      {/* Status: finding / loading / failed */}
      {/* Fades off the first frame instead of cutting to it. */}
      <AnimatePresence>
        {!(ready && started) && (
          <PlayerStatus
            key="status"
            state={source.state}
            error={error}
            logo={meta?.logo}
            name={meta?.name}
            background={meta?.background}
            onSources={() => setOptions("sources")}
          />
        )}
      </AnimatePresence>

      {notice && <div className="player-notice t-callout">{notice}</div>}

      {/* Top: back, what's playing, window-level controls. Drag lives here. */}
      <div className="player-top" data-tauri-drag-region>
        <button className="player-icon pressable" onClick={() => void exit()} aria-label="Back" title="Back (Esc)">
          <ArrowLeft size={26} />
        </button>
        <div className="player-heading" data-tauri-drag-region>
          <span className="player-heading-title">{heading}</span>
          {current && <span className="player-heading-show">{title}</span>}
        </div>
        <div className="player-top-actions">
          <div className="player-volume">
            <button className="player-icon pressable" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} title={withShortcut("Mute", "mute")}>
              <VolumeIcon size={22} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => {
                setVolume(Number(e.target.value));
                setMuted(false);
              }}
              aria-label="Volume"
              style={{ "--value": `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
            />
          </div>
          {!tv && (
            <button className="player-icon pressable" onClick={() => void toggleFullscreen()} aria-label="Fullscreen" title={withShortcut("Fullscreen", "fullscreen")}>
              {fullscreen ? <ExitFullscreen size={22} /> : <Fullscreen size={22} />}
            </button>
          )}
        </div>
        {!fullscreen && !tv && <WindowControls />}
      </div>

      {/* Centre transport, Netflix-style: bare glyphs, no button chrome. */}
      {ready && started && (
        <div className="player-center">
          <button className="player-transport pressable" onClick={() => seekBy(-seekStep)} aria-label={`Back ${seekStep} seconds`} title={withShortcut(`Back ${seekStep}s`, "seekBack")}>
            <SkipIcon direction="back" seconds={seekStep} size={56} />
          </button>
          <button className="player-transport player-transport-main pressable" onClick={togglePlay} aria-label={paused ? "Play" : "Pause"} title={withShortcut("Play/Pause", "playPause")}>
            {buffering ? (
              <Spinner className="player-spinner" size={52} label="Buffering" />
            ) : paused ? (
              <Play size={64} fill="currentColor" strokeWidth={0} />
            ) : (
              <Pause size={64} fill="currentColor" strokeWidth={0} />
            )}
          </button>
          <button className="player-transport pressable" onClick={() => seekBy(seekStep)} aria-label={`Forward ${seekStep} seconds`} title={withShortcut(`Forward ${seekStep}s`, "seekForward")}>
            <SkipIcon direction="forward" seconds={seekStep} size={56} />
          </button>
        </div>
      )}

      {/* Bottom: timeline with time left, then labelled text actions. */}
      <div
        className="player-bottom"
        onPointerEnter={() => (overControls.current = true)}
        onPointerLeave={() => (overControls.current = false)}
      >
        <div className="player-timeline">
          <Scrubber
            media={media}
            previews={seekTrack}
            span={skip.segments?.intro}
            onSeek={(t) => {
              if (videoRef.current) videoRef.current.currentTime = t;
            }}
          />
          <button
            className="player-remaining tabular"
            onClick={cycleClock}
            title="Change what the clock shows"
            aria-label={`${clockText}. Change what the clock shows`}
          >
            {clockText}
          </button>
        </div>
        <div className="player-actions">
          <ActionButton icon={<Speed size={22} />} label={`Speed (${rate}x)`} glyph={pad("speed")} onClick={() => setOptions("speed")} />
          {type === "series" && (
            <ActionButton icon={<Episodes size={22} />} label="Episodes" glyph={pad("episodes")} onClick={() => setOptions("episodes")} />
          )}
          <ActionButton icon={<Captions size={22} />} label="Subtitles & Audio" glyph={pad("tracks")} onClick={() => setOptions("tracks")} />
          <ActionButton icon={<Sources size={22} />} label="Sources" glyph={pad("sources")} onClick={() => setOptions("sources")} />
          {next && (
            <ActionButton
              icon={<SkipForward size={22} fill="currentColor" />}
              label="Next Episode"
              glyph={skip.active ? null : pad("skipOrNext", "nextEpisode")}
              onClick={() => playVideo(next.id)}
            />
          )}
        </div>
      </div>

      <OptionsOverlay
        open={options === "speed"}
        onClose={() => setOptions(null)}
        media={media}
        columns={[
          {
            title: "Playback Speed",
            value: String(rate),
            options: SPEEDS.map((r) => ({ id: String(r), label: r === 1 ? "1x (Normal)" : `${r}x` })),
            onSelect: (id) => setRate(Number(id)),
          },
        ]}
      />
      <OptionsOverlay
        open={options === "tracks"}
        onClose={() => {
          setOptions(null);
          setSubSettingsOpen(false);
        }}
        foreground={subSettingsOpen ? <SubtitlePreview style={subStyle} media={media} /> : undefined}
        media={media}
        columns={[
          {
            title: "Audio",
            value: tracks.audio.length ? tracks.audioId : "default",
            options: tracks.audio.length ? tracks.audio : [{ id: "default", label: "Default" }],
            onSelect: tracks.selectAudio,
          },
          {
            title: "Subtitles",
            size: subSettingsOpen ? "medium" : "narrow",
            header: (
              <button
                className="options-head-btn"
                aria-pressed={subSettingsOpen}
                aria-label="Subtitle settings"
                title="Subtitle settings"
                onClick={() => setSubSettingsOpen((v) => !v)}
              >
                <Cog size={19} strokeWidth={2.1} />
              </button>
            ),
            content: subSettingsOpen ? (
              <SubtitleSettings
                style={subStyle}
                onChange={(patch) => updateSettings.mutate({ subtitleStyle: { ...subStyle, ...patch } })}
                delay={subDelay}
                onDelay={setSubDelay}
                canPosition={engine === "mpv"}
              />
            ) : undefined,
            value: tracks.subId,
            options: tracks.subtitles,
            onSelect: (id) => void tracks.selectSubtitle(id),
            empty: tracks.subtitlesLoading ? "Loading…" : undefined,
          },
        ]}
      />

      <SkipButton
        active={started ? skip.active : null}
        onSkip={skip.skipActive}
        chromeVisible={chromeVisible}
        glyph={showNextUp ? null : pad("skipOrNext", "nextEpisode")}
      />

      <AnimatePresence>
        {showNextUp && next && (
          <motion.div
            className="next-up"
            initial={{ opacity: 0, transform: "translateX(24px)" }}
            animate={{ opacity: 1, transform: "translateX(0px)" }}
            // Arrives at drawer pace; leaves faster — a dismissal shouldn't linger.
            exit={{ opacity: 0, transform: "translateX(24px)", transition: { duration: 0.18, ease: ease.out } }}
            transition={{ duration: 0.3, ease: ease.drawer }}
          >
            <div className="next-up-still">
              <Img src={next.thumbnail ?? meta?.background} alt="" />
            </div>
            <div className="next-up-text">
              <span className="next-up-kicker">
                {ended && stillWatching ? "Are you still watching?" : `Up Next · ${episodeCode(next.season, next.episode)}`}
              </span>
              {skipped.length > 0 && !(ended && stillWatching) && (
                <span className="next-up-skipping">
                  Skipping filler: {skipped.length === 1 ? `episode ${skipped[0].episode}` : `episodes ${skipped[0].episode}–${skipped[skipped.length - 1].episode}`}
                </span>
              )}
              <span className="next-up-title">{next.title}</span>
              <div className="next-up-actions">
                <button
                  className="btn btn-primary next-up-play"
                  onClick={() => {
                    autoplayStreak = 0;
                    playVideo(next.id);
                  }}
                >
                  {ended && willAutoplay && (
                    <span className="next-up-countdown" style={{ animationDuration: `${countdown}s` }} />
                  )}
                  {pad("skipOrNext", "nextEpisode") ?? <Play size={16} fill="currentColor" />} {ended && stillWatching ? "Keep Watching" : "Play Now"}
                </button>
                <button className="btn btn-glass btn-icon next-up-dismiss" onClick={() => setNextDismissed(true)} aria-label="Dismiss">
                  <Close size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <OptionsOverlay
        open={options === "episodes"}
        onClose={() => setOptions(null)}
        media={media}
        columns={[
          {
            title: "Seasons",
            value: String(shownSeason),
            options: seasons.map((n) => ({ id: String(n), label: seasonLabel(n) })),
            onSelect: (id) => setPickSeason(Number(id)), // browse; playback continues
          },
          {
            title: "Episodes",
            size: "wide",
            value: videoId,
            options: episodeItems,
            onSelect: (id) => id !== videoId && playVideo(id),
          },
        ]}
      />
      <OptionsOverlay
        open={options === "sources"}
        onClose={() => setOptions(null)}
        media={media}
        columns={[
          {
            title: "Sources",
            size: "wide",
            header: (
              <div className="source-controls">
                <SourceFilterBar
                  f={sourceFilters}
                  tv={tv}
                  note={hiddenSources > 0 ? `${hiddenSources} more hidden by Settings → Sources` : undefined}
                />
              </div>
            ),
            value: currentSourceIndex >= 0 ? String(currentSourceIndex) : undefined,
            options: sourceItems,
            empty: streams.isLoading
              ? "Finding sources…"
              : streams.isError
                ? "Couldn't load sources."
                : sourceFilters.total > 0
                  ? "No sources match these filters."
                  : hiddenSources > 0
                    ? `All ${hiddenSources} sources are hidden by your filters in Settings → Sources.`
                    : "No sources found.",
            onSelect: (id) => {
              const pick = rankedStreams[Number(id)];
              if (pick && Number(id) !== currentSourceIndex) playVideo(videoId, pick.stream);
            },
          },
        ]}
      />
    </div>
  );
}

/** How far the logo has filled in for each loading stage (0–100). */
const FILL = { searching: 34, resolving: 66, starting: 92, done: 100 } as const;

/**
 * Loading screen, Netflix-style: the title's logo (or name) sits greyed out
 * and fills with colour left to right as loading advances — finding a source,
 * connecting, buffering the first frames. Real stages, not a fake timer: each
 * one moves the fill further, and a slow creep within a stage shows life
 * while a slow server answers.
 */
function PlayerStatus({
  state,
  error,
  logo,
  name,
  background,
  onSources,
}: {
  state: ReturnType<typeof useSource>["state"];
  error: string | null;
  logo?: string;
  name?: string;
  background?: string;
  onSources: () => void;
}) {
  const failed = state.status === "failed" || !!error;

  const stage = state.status === "searching" ? "searching" : state.status === "resolving" ? "resolving" : "starting";
  const message = failed
    ? (error ?? (state.status === "failed" ? state.reason : ""))
    : stage === "searching"
      ? "Finding the best source"
      : stage === "resolving"
        ? `Connecting${state.status === "resolving" && state.label ? ` · ${state.label}` : ""}`
        : "Starting";

  return (
    <motion.div
      className="player-status"
      data-failed={failed}
      exit={{ opacity: 0, transition: { duration: 0.4, ease: ease.out } }}
    >
      {background && <Img src={background} alt="" className="player-status-bg" />}
      <div className="player-status-content">
        <div className="load-mark" style={{ "--fill": `${failed ? 0 : FILL[stage]}%` } as React.CSSProperties}>
          {logo ? (
            <>
              <img src={logo} alt={name ?? ""} className="load-mark-base" />
              <img src={logo} alt="" aria-hidden className="load-mark-fill" />
            </>
          ) : (
            <>
              <span className="load-mark-base load-mark-text">{name}</span>
              <span aria-hidden className="load-mark-fill load-mark-text">
                {name}
              </span>
            </>
          )}
        </div>
        <p key={message} className="player-status-message t-callout" role="status">
          {message}
        </p>
        {failed && (
          <div className="player-status-actions">
            {/* Focused, so Enter (or a controller's A) picks it straight away. */}
            <button className="btn btn-primary" onClick={onSources} autoFocus>
              <Sources size={17} /> Choose Another Source
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ActionButton({
  icon,
  label,
  glyph,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  /** The controller button that does the same (TV mode with a controller). */
  glyph?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="player-action pressable" onClick={onClick}>
      {icon}
      <span>{label}</span>
      {glyph}
    </button>
  );
}
