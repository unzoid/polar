import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Captions,
  Cast,
  Close,
  Episodes,
  ExitFullscreen,
  LayoutList,
  LayoutRow,
  Fullscreen,
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
import { ease, useFormFactor } from "../lib/ui";
import { anchorOf, appWindow, isDesktop, isMac, nativeDialogsAvailable, showNativeDialog } from "../lib/platform";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Img } from "../components/Img";
import { Spinner } from "../components/Spinner";
import { streamKey } from "../components/StreamList";
import { SourceFilterBar } from "../components/SourceFilters";
import { TvSourceMenu, useSourceInfo } from "../components/SourceInfo";
import { playingReport } from "../components/player/playingReport";
import {
  autoplayStreak,
  countAutoplay,
  requestHeaders,
  videoFile,
  READY_CHECKS,
  readinessNote,
  resetAutoplay,
  screenResolution,
  sliderAmplitude,
  sourceRow,
  useReadiness,
  useResetAutoplayOnInput,
  useSourceFilters,
} from "../lib/playback";
import { downloadedStream, episodeState, isLocalFile, nextVideo, progressMap, seasonsOf, useDownloads, watchedFraction } from "../lib/library";
import { WindowControls } from "../components/WindowControls";
import { Scrubber } from "../components/player/Scrubber";
import { useSource } from "../components/player/useSource";
import { SkipButton, useSkipSegments } from "../components/player/SkipSegments";
import { OptionsOverlay, type OptionItem } from "../components/player/OptionsOverlay";
import { VolumeHud, type VolumePing } from "../components/player/VolumeHud";
import { EpisodeRail } from "../components/player/EpisodeRail";
import { Dropdown } from "../components/Dropdown";
import { SkipTransport } from "../components/player/SkipTransport";
import { useTracks } from "../components/player/useTracks";
import { pickedSpeed, pickedTrack, speedLabel, speedMenu, tracksMenu } from "../components/player/nativeMenus";
import {
  DEFAULT_SUBTITLE_STYLE,
  SubtitlePreview,
  SubtitleSettings,
  applySubtitleStyleToMpv,
  forgetAssOverride,
  subtitleCueVars,
} from "../components/player/SubtitleSettings";
import { MpvMedia, type MediaLike, type StepDetail } from "../components/player/mpvMedia";
import { listenProbe, nextProbeId, probeStep, useStartLog } from "../components/player/useStartLog";
import { getPrefs, openSettings, setPrefs, useEpisodeLayout, usePrefs, withShortcut } from "../lib/settings";
import { Segmented } from "../components/Segmented";
import { api } from "../lib/api";
import { useAccount } from "../lib/account";
import { airLabel, episodeCode, formatRemaining, formatTime, seasonLabel } from "../lib/format";
import { keys, prefetchStreams, useMeta, useProgress, useSettings, useStreams, useUpdateSettings } from "../lib/net";
import { useRouter } from "../lib/router";
import type { ContentType, Progress, RankedStream, Stream, Video } from "../lib/types";
import { playContext, stillFor } from "../lib/anime";
import { useMpvTune } from "../components/player/useMpvTune";
import { useTvMode } from "../tv/tvMode";
import { usePadGlyph } from "../tv/TvChrome";
import { fileStream, isFileId, recentPosition } from "../lib/localFiles";
import { getParty, isLinkId, linkLabel, linkMedia, partyAvailable, partyPosition, startParty, streamHint, useParty } from "../lib/party";
import { usePartySync } from "../components/player/usePartySync";
import { useDiscordPresence } from "../components/player/useDiscordPresence";
import { LinkForm, PartyBadge, PartyHold, PartyInvite, PartyMembers, PartyNotes, PartyStart } from "../components/party/PartyUI";
import { PartyActions, PartyHostControls } from "../components/party/PartyMenu";
import { WatchParty } from "../components/icons";
import { Button, IconButton } from "../components/ui/Button";
import { errorMessage, storeLocal, warnFailed } from "../lib/errors";
import { PLAYER_EXIT_MS } from "../components/PlayerLayer";
import { PlayerStatus } from "../components/player/PlayerStatus";
import { TorrentNotice } from "../components/player/TorrentNotice";
import { PlayerClock, TIME_DISPLAYS } from "../components/player/PlayerClock";
import { useMediaTime } from "../components/player/useMediaTime";
import { usePlayerChrome } from "../components/player/usePlayerChrome";
import { usePlayerKeyboard } from "../components/player/usePlayerKeyboard";
import { useProgressSaver } from "../components/player/useProgressSaver";
import { useAirPlay } from "../components/player/useAirPlay";

const win = appWindow;
/** In a watch party, how long a source gets to start before the next one is tried. */
const PARTY_START_MS = 20_000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** With "Up next" set to the very end, it appears this many seconds before. */
const NEXT_UP_AT_END = 12;


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
  // A link pasted into a watch party (#136): no title behind it, so no title page, episodes, sources,
  // progress or lookups by id; it plays the URL it came with.
  const link = isLinkId(metaId) ? stream?.url : undefined;
  // A video file on this device (#204): its title is the file or its folder (lib/localFiles), its
  // source the file itself, and where it stopped is kept on this device; nothing is looked up online.
  const local = isFileId(metaId);
  const { data: meta } = useMeta(type, metaId, !isLinkId(metaId) && !local);
  const { data: settings } = useSettings();
  const { touch } = useFormFactor();
  // Engine: embedded mpv when installed (plays every codec, AC3/DTS audio, every
  // subtitle format), else the WebView's own <video>.
  const engineQuery = useQuery({ queryKey: keys.mpv, queryFn: api.mpvAvailable, staleTime: Infinity });
  const engine: "mpv" | "html" | null = engineQuery.isFetched ? (engineQuery.data ? "mpv" : "html") : null;
  const mpv = useMemo(() => new MpvMedia(), []);
  // Watch party: signed-in profiles only. Joining the room's video, look for the file it's on.
  const { profile } = useAccount();
  const canParty = partyAvailable() && !!profile;
  const [roomHint] = useState(() => {
    const p = getParty()?.playback;
    return p?.media.videoId === videoId ? p.media.hint : undefined;
  });
  // What the loading screen lists as it happens (and copies for a bug report).
  const { steps, add: logStep } = useStartLog();
  useEffect(() => {
    if (engine === "mpv") logStep("Player: mpv", "info", "player");
    // What the built-in player can't do depends on the file's codecs and the machine, not on MKV (test report 1, item 23).
    else if (engine === "html")
      logStep("Player: built-in (mpv isn't installed, so some files may not play: AC3/DTS audio, HEVC where the system can't decode it)", "info", "player");
  }, [engine, logStep]);
  const startedRef = useRef(false);
  const playStream = stream ?? (local ? fileStream(videoId) : undefined);
  const source = useSource(type, metaId, videoId, playStream, roomHint, logStep, () => startedRef.current);

  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  /** What plays in the app; `media` is what the controls drive, an AirPlay receiver's element while casting with mpv. */
  const baseMedia: MediaLike | null = engine === "mpv" ? mpv : videoEl;
  const baseRef = useRef<MediaLike | null>(null);
  baseRef.current = baseMedia;
  const videoRef = useRef<MediaLike | null>(null);
  const [paused, setPaused] = useState(true);
  const [buffering, setBuffering] = useState(true);
  // Until the first frame actually plays, the loading screen stays up.
  const [started, setStarted] = useState(false);
  startedRef.current = started;
  // Watch party state, needed this early by AirPlay (never both at once).
  const party = useParty();

  // --- Progress -------------------------------------------------------------
  // Before AirPlay: leaving the player saves the receiver's position before the cast ends.
  const current = meta?.videos.find((v) => v.id === videoId);
  const { save, saveIfDue } = useProgressSaver({ media: videoRef, meta, type, metaId, videoId, current, state: source.state });

  // --- AirPlay (#19) ----------------------------------------------------------
  const playingUrl = source.state.status === "ready" && started ? source.state : undefined;
  const airplay = useAirPlay({
    media: baseMedia,
    video: engine === "html" ? videoEl : null,
    url: playingUrl?.url,
    headers: playingUrl ? requestHeaders(playingUrl.stream) : null,
    enabled: !party,
  });
  const media: MediaLike | null = airplay.media ?? baseMedia;
  videoRef.current = media;
  /** Why the link check turned the built-in player's source down (mpv reports its own). */
  const linkError = useRef<string | null>(null);
  const [volume, setVolume] = useState(savedVolume);
  // TV mode: each volume press from the controller or remote shows the volume HUD.
  const [volumePing, setVolumePing] = useState<VolumePing>({ n: 0, dir: "up" });
  const pingVolume = (dir: VolumePing["dir"]) => tv && setVolumePing((p) => ({ n: p.n + 1, dir }));
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, flashNotice] = useNotice();
  const [ended, setEnded] = useState(false);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [options, setOptions] = useState<"speed" | "tracks" | "episodes" | "sources" | "party" | null>(null);
  // iOS's own menu is up (Speed, Subtitles & Audio): the controls stay while it is.
  const [nativeMenu, setNativeMenu] = useState(false);
  const updateSettings = useUpdateSettings();
  // Settings → Playback → "Remember playback speed" (settings may arrive after the player opens).
  const [picked, setPicked] = useState<number>();
  const rate = picked ?? (settings?.rememberSpeed && settings.playbackSpeed > 0 ? settings.playbackSpeed : 1);
  const setRate = (r: number) => {
    setPicked(r);
    if (settings?.rememberSpeed) updateSettings.mutate({ playbackSpeed: r });
  };
  const seekStep = settings?.seekStep ?? 10;
  // Each seek from the centre buttons, a double-tap, or the seek keys (and so the controller): SkipTransport shows the jump.
  const [kicks, setKicks] = useState({ back: 0, forward: 0 });
  const kick = (dir: "back" | "forward") => setKicks((k) => ({ ...k, [dir]: k[dir] + 1 }));
  const hideAfter = Math.max(1, settings?.controlsHideSecs ?? 2) * 1000;
  const countdown = Math.max(3, settings?.autoplayCountdown ?? 8);
  const timeDisplay = settings?.timeDisplay ?? "remaining";
  useMpvTune(engine === "mpv" ? mpv : null);
  // Subtitle look (saved) and timing offset (this video only).
  const subStyle = settings?.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;
  const [subDelay, setSubDelay] = useState(0);
  const [subSettingsOpen, setSubSettingsOpen] = useState(false);

  // Subtitle add-ons match on the file's size and name (React Query compares keys by value).
  const playingFile = videoFile(source.state.status === "ready" ? source.state.stream : undefined);
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
    playingFile,
    // Subtitles beside a file on this device load with it (mpv's sub-auto); add-ons aren't asked.
    !local,
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
  const durationS = useMediaTime(media, (t) => Math.round(t.duration));
  const { data: seekTrack } = useQuery({
    queryKey: keys.seekr(videoId, durationS),
    queryFn: () => api.seekPreviews(videoId, durationS * 1000),
    enabled: !!settings?.seekPreviews && !!settings?.seekrKey && durationS > 0 && !link && !local,
    staleTime: Infinity,
    retry: false,
  });

  // --- Chrome visibility --------------------------------------------------
  const { chrome, poke, hide: hideChrome, overControls } = usePlayerChrome(hideAfter);
  const ready = source.state.status === "ready" && !error;
  const chromeVisible = chrome.visible || paused || !!options || nativeMenu || !ready;
  // Whether the controls showed when the press on the picture began: the
  // player's own pointerdown shows them before the click, so a tap that should
  // bring them back would otherwise hide them again at once.
  const chromeAtPress = useRef(false);

  // --- Current / next episode ---------------------------------------------
  const { animeSkipFiller } = usePrefs();
  // With "Skip filler" on, the next episode that isn't filler; `skipped` says how many were passed over.
  const { next, skipped } = useMemo(() => {
    let n = meta && type === "series" ? nextVideo(meta, videoId) : undefined;
    const skipped: Video[] = [];
    while (n && animeSkipFiller && playContext.isFiller(n.id) && meta) {
      skipped.push(n);
      n = nextVideo(meta, n.id);
    }
    return { next: n, skipped };
  }, [meta, type, videoId, animeSkipFiller]);
  const title = link ? stream?.name || linkLabel(link) : (meta?.name ?? "");
  const heading = local ? (current?.title ?? title) : current ? `${episodeCode(current.season, current.episode)} · ${current.title}` : title;

  // --- Watch party ------------------------------------------------------------
  const playingStream = source.state.status === "ready" ? source.state.stream : undefined;
  // A link is its own file: no release name for others to look for.
  const hint = useMemo(() => (link ? undefined : streamHint(playingStream)), [link, playingStream]);
  const partyMedia = link ? linkMedia(link) : { type, metaId, videoId, label: heading || undefined };
  usePartySync({ media, current: partyMedia, started, buffering, hint, leaving });
  const startHere = () => {
    const v = videoRef.current;
    if (!party && profile && v) startParty({ ...partyMedia, hint }, v.currentTime, v.paused, profile);
  };

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
  const resumePoint = (r?: Pick<Progress, "position" | "duration">) => {
    if (settings?.resumePlayback === false || !r || r.position <= 30 || r.position / r.duration >= watchedFraction()) return undefined;
    return Math.max(0, r.position - (settings?.resumeRewind ?? 0));
  };
  const resumed = useRef(false);
  useEffect(() => {
    // Always the app's own player: handing over to AirPlay and back isn't a new source.
    const v = baseRef.current;
    if (!v || source.state.status !== "ready") return;
    resumed.current = false;
    setError(null);
    setBuffering(true);
    v.volume = sliderAmplitude(volume);
    if (v instanceof MpvMedia) {
      // Start at the resume point (or where the watch party is) directly: no
      // fetching the opening of a network stream only to seek away from it.
      const start = partyPosition(videoId) ?? resumePoint(source.resume ?? (local ? recentPosition(videoId) : undefined));
      resumed.current = true;
      v.load(source.state.url, start, requestHeaders(source.state.stream));
    } else if (v instanceof HTMLVideoElement) {
      const url = source.state.url;
      const play = (src: string) => {
        v.src = src;
        v.play().catch(() => setPaused(true));
      };
      linkError.current = null;
      if (isLocalFile(url)) return play(url);
      // The same link check mpv_load runs, so this player gets the warmed link and the same steps.
      let cancelled = false;
      const id = nextProbeId();
      const unlisten = listenProbe(id, (e) => logStep(...probeStep(e)));
      api
        .streamProbe(url, id, requestHeaders(source.state.stream))
        .then(
          (final) => !cancelled && play(final),
          (e) => {
            if (cancelled) return;
            linkError.current = errorMessage(e);
            logStep(errorMessage(e), "fail", "server");
            v.dispatchEvent(new Event("error"));
          },
        )
        .finally(() => void unlisten.then((f) => f()));
      return () => {
        cancelled = true;
      };
    }
    // Volume is applied by its own effect; only a new source reloads.
  }, [source.state, baseMedia]);

  // Handing over to AirPlay or back: the controls show the new element's state at once.
  useEffect(() => {
    if (media) setPaused(media.paused);
  }, [media]);

  // mpv's own steps (link check, opening, buffering) go to the log until the picture starts.
  useEffect(() => {
    if (!media) return;
    const onStep = (e: Event) => {
      const d = (e as CustomEvent<StepDetail>).detail;
      if (!startedRef.current) logStep(d.text, d.tone, d.stage, d.key);
    };
    media.addEventListener("step", onStep);
    return () => media.removeEventListener("step", onStep);
  }, [media, logStep]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = sliderAmplitude(volume);
    v.muted = muted;
    storeLocal("polar.volume", String(volume));
  }, [volume, muted, media]);

  // A watch party plays at 1x for everyone (its sync nudges the rate itself).
  const inParty = !!party;
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = inParty ? 1 : rate;
  }, [rate, source.state, media, inParty]);

  // In a party, a source that won't start keeps the whole room waiting: move
  // on to the next one, as picking another source by hand would.
  const sourceNext = source.next;
  useEffect(() => {
    if (!inParty || started || source.state.status !== "ready") return;
    const t = window.setTimeout(() => {
      logStep(`Not playing after ${PARTY_START_MS / 1000} s; the watch party is waiting`, "warn", "player");
      if (sourceNext()) flashNotice("That source was slow to start. Trying the next best one.", 3500);
    }, PARTY_START_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new attempt is a new source.state
  }, [inParty, started, source.state]);

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
  const { pauseOnMinimize, discordPresence } = usePrefs();
  // A file on this device stays private: its name isn't shown on Discord.
  useDiscordPresence(media, meta, videoId, local ? "off" : discordPresence);
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
  useResetAutoplayOnInput();

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
    waiting: () => {
      setBuffering(true);
      if (!startedRef.current) logStep("Buffering", "info", "player", "buffer");
    },
    playing: () => {
      setBuffering(false);
      if (!startedRef.current) logStep("Playing", "ok", "player");
      setStarted(true);
    },
    canplay: () => setBuffering(false),
    loadedmetadata: () => {
      const v = videoRef.current!;
      const start = partyPosition(videoId) ?? resumePoint(source.resume ?? (local ? recentPosition(videoId) : undefined));
      if (!resumed.current && start != null) v.currentTime = start;
      resumed.current = true;
      if (!startedRef.current) {
        const length = Number.isFinite(v.duration) ? ` · ${formatTime(v.duration)} long` : " · live or unknown length";
        logStep(`File opened${length}${start != null ? `, starting at ${formatTime(start)}` : ""}`, "ok", "player");
      }
    },
    // The time itself is read where it's shown (useMediaTime), not stored here.
    timeupdate: () => {
      if (!videoRef.current!.paused) setStarted(true);
      saveIfDue();
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
      const el = videoRef.current;
      if (el instanceof HTMLVideoElement && el.error) {
        const kinds = ["", "loading was stopped", "network error", "couldn't decode it", "format not supported"];
        logStep(`Built-in player: ${kinds[el.error.code] ?? `error ${el.error.code}`}${el.error.message ? ` (${el.error.message})` : ""}`, "fail", "player");
      }
      if (!exited && source.next()) {
        logStep("Trying the next source", "warn");
        flashNotice("That source didn't load. Trying the next best one.", 3500);
      } else {
        const v = videoRef.current;
        setError(
          v instanceof MpvMedia
            ? (v.error?.message ?? "This file couldn't be played.")
            : linkError.current
              ? linkError.current
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

  const seekTo = useCallback((t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  }, []);

  const onAutoSkipped = useCallback((label: string) => flashNotice(label, 2500), [flashNotice]);
  const { preferFileChapters, autoSkipDelay } = usePrefs();
  const skip = useSkipSegments({
    videoId,
    started,
    autoSkip: { intro: !!settings?.autoSkip, recap: settings?.autoSkipRecaps ?? !!settings?.autoSkip },
    autoSkipDelay,
    media,
    preferFile: preferFileChapters,
    seekTo,
    onAutoSkipped,
    online: !link && !local,
  });

  // A phone or tablet has no window to make fullscreen: its button fits the picture inside the
  // screen or fills the screen with it, cropping the edges (#148, #149). Autocrop (Settings →
  // Advanced) still takes the black bars off a fitted picture.
  const { videoFill } = usePrefs();
  const fill = !isDesktop && videoFill;
  useEffect(() => {
    if (engine === "mpv" && !isDesktop) void mpv.set("panscan", fill ? 1 : 0);
  }, [engine, mpv, fill]);
  const toggleFill = useCallback(() => setPrefs({ videoFill: !getPrefs().videoFill }), []);

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
  // Side by side or a list: the same choice as the title page's switch (#226).
  const [episodeLayout, setEpisodeLayout] = useEpisodeLayout();
  const layoutSwitch = (
    <Segmented
      label="Episode layout"
      value={episodeLayout}
      onChange={setEpisodeLayout}
      options={[
        { id: "row", label: "Row", icon: <LayoutRow size={18} /> },
        { id: "list", label: "List", icon: <LayoutList size={18} /> },
      ]}
    />
  );
  // Only fetched once the Sources picker is opened (and usually cached already).
  const streams = useStreams(type, options === "sources" ? videoId : undefined);

  const episodeItems = useMemo<OptionItem[]>(
    () =>
      (meta?.videos ?? [])
        .filter((v) => v.season === shownSeason)
        .map((v) => {
          const p = progressById.get(v.id);
          const { released, openable, fraction, watched, inProgress } = episodeState(v, p, watchedFraction());
          return {
            id: v.id,
            label: `${v.episode}. ${v.title}`,
            detail: released && inProgress && p ? formatRemaining(p.position, p.duration) : airLabel(v),
            thumbnail: stillFor(v.id) ?? v.thumbnail ?? "",
            progress: watched ? undefined : fraction,
            badge: watched ? { text: "Watched" } : undefined,
            disabled: !openable,
          };
        }),
    [meta, shownSeason, progressById],
  );

  const rankedStreams = useMemo(() => streams.data?.streams ?? [], [streams.data]);
  const currentKey = source.state.status === "ready" ? streamKey(source.state) : undefined;
  // A finished download of this video is listed first (#23): back to it after trying another source.
  const { data: downloads } = useDownloads();
  const downloaded = useMemo(() => downloadedStream(downloads, videoId), [downloads, videoId]);
  // Filter (add-on, resolution, language, size, tags) and sort, as on the
  // title page. Ids stay the index into the ranked list, so selection works
  // regardless of the view. Kept for this show while the player stays open,
  // through picking a source or moving to another episode (each rebuilds it).
  const sourceFilters = useSourceFilters(streams.data?.streams, settings, metaId);
  const hiddenSources = streams.data?.hidden ?? 0;
  // The first few sources get a look ahead of time while the panel is open (#21).
  const readiness = useReadiness(
    sourceFilters.view.slice(0, Math.min(sourceFilters.matched, READY_CHECKS)).map(({ r }) => r),
    options === "sources",
  );
  // A source's "i" panel (#229); on TV, the row's menu that leads to it. The playing source adds what the player reports.
  const sourceInfo = useSourceInfo(tv);
  const [sourceMenu, setSourceMenu] = useState<{ r: RankedStream; anchor: HTMLElement } | null>(null);
  const showSourceInfoRef = useRef<(r: RankedStream, anchor: HTMLElement) => void>(() => {});
  showSourceInfoRef.current = (r, anchor) => {
    const playing = currentKey !== undefined && streamKey(r) === currentKey;
    void (playing ? playingReport(media) : Promise.resolve(undefined)).then((report) =>
      sourceInfo.show(
        r,
        sourceRow(r).title,
        { filter: sourceFilters.filter, sort: sourceFilters.sort, screen: screenResolution(), preferScreen: settings?.preferScreenResolution ?? true, playing: report },
        anchor,
      ),
    );
  };
  const sourceItems = useMemo<OptionItem[]>(() => {
    const rank = new Map(rankedStreams.map((r, i) => [r, i]));
    return sourceFilters.view.map(({ r, match }, n) => {
      const row = sourceRow(r);
      const ready = readiness.get(streamKey(r));
      const note = ready && readinessNote(ready);
      return {
        id: String(rank.get(r) ?? -1),
        label: n === 0 && match && !r.otherEpisode && sourceFilters.sort === "best" ? `${row.title} · Best Match` : row.title,
        // Filters that only order the list: what doesn't match follows under its own heading.
        heading:
          n === sourceFilters.otherEpisodes ? "Other episodes" : n === sourceFilters.matched && n < sourceFilters.otherEpisodes ? "Other sources" : undefined,
        detail: [note?.short, row.size, r.otherEpisode ? r.fileEpisode : null, row.detail].filter(Boolean).join(" · "),
        badge: r.quality.lowQualitySource ? { text: "CAM", tone: "bad" as const } : undefined,
        ready: ready?.state === "ready" ? "yes" : ready?.state === "notReady" ? "no" : undefined,
        note: note?.long,
        onInfo: (anchor: HTMLElement) => showSourceInfoRef.current(r, anchor),
        onMenu: tv ? (anchor: HTMLElement) => setSourceMenu({ r, anchor }) : undefined,
      };
      });
  }, [rankedStreams, sourceFilters.view, sourceFilters.matched, sourceFilters.otherEpisodes, sourceFilters.sort, readiness, tv]);
  const sourceOptions = useMemo<OptionItem[]>(
    () =>
      downloaded
        ? [
            { id: DOWNLOADED, label: "Downloaded copy", detail: [downloaded.title, "On this device"].filter(Boolean).join(" · "), badge: { text: "Downloaded", tone: "good" } },
            ...sourceItems,
          ]
        : sourceItems,
    [downloaded, sourceItems],
  );
  const currentSourceIndex = useMemo(() => rankedStreams.findIndex((r) => streamKey(r) === currentKey), [rankedStreams, currentKey]);
  const currentSource = downloaded && currentKey === downloaded.url ? DOWNLOADED : currentSourceIndex >= 0 ? String(currentSourceIndex) : undefined;

  // --- Keyboard: instant, never animated -------------------------------------
  // A panel opened from a key (or a pad button) is there at once; a click keeps the frosted materialize.
  const [optionsByKey, setOptionsByKey] = useState(false);
  useEffect(() => {
    if (!options) setOptionsByKey(false);
  }, [options]);
  const toggleOptions = (o: NonNullable<typeof options>) => {
    setOptionsByKey(true);
    setOptions((open) => (open === o ? null : o));
  };
  // A tap on Speed or Subtitles & Audio: on iOS the system's menu from the button (nativeMenus.ts), elsewhere the picker.
  const openOptions = (o: NonNullable<typeof options>, from: Element) => {
    if (!nativeDialogsAvailable || (o !== "speed" && o !== "tracks")) return setOptions(o);
    const menu = o === "speed" ? speedMenu(SPEEDS, rate) : tracksMenu(tracks);
    setNativeMenu(true);
    showNativeDialog({ ...menu, anchor: anchorOf(from) })
      .then((id) => {
        if (o === "speed") {
          const r = pickedSpeed(id);
          if (r != null && r !== rate) setRate(r);
          return;
        }
        const pick = pickedTrack(id);
        if (pick === "settings") {
          setSubSettingsOpen(true);
          setOptions("tracks");
        } else if (pick && "audio" in pick) {
          if (pick.audio !== tracks.audioId) tracks.selectAudio(pick.audio);
        } else if (pick && pick.subtitle !== tracks.subId) void tracks.selectSubtitle(pick.subtitle);
      })
      .catch(warnFailed("menu"))
      .finally(() => setNativeMenu(false));
  };
  // The page underneath has the keyboard already while the player fades out; the torrent notice has it while it's up.
  const torrentNotice = source.state.status === "notice";
  usePlayerKeyboard(
    !leaving && !torrentNotice,
    (action) => {
      switch (action) {
        case "playPause":
          togglePlay();
          return true;
        case "seekBack":
          seekBy(-seekStep);
          kick("back");
          return true;
        case "seekForward":
          seekBy(seekStep);
          kick("forward");
          return true;
        case "volumeUp":
          setVolume((v) => Math.min(1, +(v + 0.1).toFixed(2)));
          pingVolume("up");
          setMuted(false);
          return true;
        case "volumeDown":
          setVolume((v) => Math.max(0, +(v - 0.1).toFixed(2)));
          pingVolume("down");
          return true;
        case "mute":
          setMuted((m) => !m);
          pingVolume("mute");
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
        case "sources":
          if (link || local) return false;
          toggleOptions(action);
          return true;
        case "tracks":
        case "speed":
          toggleOptions(action);
          return true;
        case "episodes":
          if (type !== "series") return false;
          toggleOptions(action);
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
    },
    // TV: volume keys show only the volume HUD, not the whole player.
    (action) => {
      if (tv && (action === "volumeUp" || action === "volumeDown" || action === "mute")) return;
      // A seek with the controls hidden shows just its skip button and the "+10" (SkipTransport), not the controls.
      if (!chromeVisible && (action === "seekBack" || action === "seekForward")) return;
      poke(true);
    },
  );

  // Warm the next episode's sources well before the credits.
  const prefetchedNext = useRef(false);
  const pastThreeQuarters = useMediaTime(media, (t) => t.duration > 0 && t.current / t.duration > 0.75);
  useEffect(() => {
    if (next && !prefetchedNext.current && pastThreeQuarters) {
      prefetchedNext.current = true;
      prefetchStreams(type, next.id);
    }
  }, [next, pastThreeQuarters, type]);

  // Autoplay countdown once the episode ends, unless it's time to ask
  // whether anyone's still watching (Settings → Playback).
  const askAfter = settings?.stillWatchingAfter ?? 0;
  const stillWatching = askAfter > 0 && autoplayStreak() >= askAfter;
  const willAutoplay = !!settings?.autoplayNext && !stillWatching;
  useEffect(() => {
    if (!ended || !next || nextDismissed || !willAutoplay) return;
    const t = window.setTimeout(() => {
      countAutoplay();
      playVideo(next.id);
    }, countdown * 1000);
    return () => window.clearTimeout(t);
  }, [ended, next, nextDismissed, willAutoplay, countdown, playVideo]);

  // With IntroDB credit timings, "Up next" arrives exactly when the credits
  // roll (Netflix-style); without them, fall back to the last ~40s. Settings
  // can hold it back until the very end instead.
  const creditsStart = skip.segments?.outro?.start;
  const postCredits = !!skip.segments?.postCredits;
  const atEnd = settings?.nextUpTiming === "end";
  const nearEnd = useMediaTime(media, (t) => {
    if (!(t.duration > 0)) return "unknown";
    const remaining = t.duration - t.current;
    const inCredits = creditsStart != null && t.current >= creditsStart && !postCredits;
    return (atEnd ? remaining <= NEXT_UP_AT_END : inCredits || (creditsStart == null && remaining <= Math.max(40, t.duration * 0.04))) ? "yes" : "no";
  });
  const showNextUp = !!next && !nextDismissed && nearEnd !== "unknown" && (ended || nearEnd === "yes");

  const cycleClock = () =>
    updateSettings.mutate({ timeDisplay: TIME_DISPLAYS[(TIME_DISPLAYS.indexOf(timeDisplay) + 1) % TIME_DISPLAYS.length] });

  const VolumeIcon = muted || volume === 0 ? VolumeMuted : Volume;

  return (
    <div
      className="player"
      data-engine={engine ?? undefined}
      data-fill={fill || undefined}
      data-buffering={buffering && ready}
      data-chrome={chromeVisible}
      data-instant={chrome.instant}
      data-options={!!options}
      data-options-instant={optionsByKey}
      data-started={started}
      onPointerMove={() => poke()}
      onPointerDown={() => poke()}
    >
      {engine === "html" && (
        <video ref={setVideoEl} className="player-video" playsInline style={subtitleCueVars(subStyle)} />
      )}
      {/* Click target over either engine: tap to play/pause, double-click for
          fullscreen (on touch, a side's double-tap seeks), wheel for volume. */}
      <div
        className="player-surface"
        // Respond immediately; double-click adds fullscreen on top. Settings
        // can make a click only show/hide the controls instead; a tap always
        // does, as on every phone player (Play/Pause is in the controls).
        onPointerDown={() => (chromeAtPress.current = chrome.visible)}
        onClick={() => {
          if (!touch && settings?.clickAction !== "controls") return togglePlay();
          if (chromeAtPress.current) hideChrome();
          else poke();
        }}
        // A finger double-taps the left or right third to skip back or ahead, as phone players do;
        // the middle (and a mouse anywhere) toggles fullscreen.
        onDoubleClick={(e) => {
          const third = e.currentTarget.clientWidth / 3;
          const x = e.nativeEvent.offsetX;
          if (touch && (x < third || x > third * 2)) {
            seekBy((x < third ? -1 : 1) * seekStep);
            kick(x < third ? "back" : "forward");
            return poke(true);
          }
          if (!isDesktop) return toggleFill();
          void toggleFullscreen();
        }}
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
            name={link ? title : meta?.name}
            background={meta?.background}
            steps={steps}
            backend={engine === "html" ? "built-in" : (engine ?? "not chosen yet")}
            onSources={link || local ? undefined : () => setOptions("sources")}
          />
        )}
      </AnimatePresence>

      {torrentNotice && !leaving && (
        <TorrentNotice
          onPlay={() => source.answerNotice(true)}
          onCancel={() => {
            source.answerNotice(false);
            void exit();
          }}
          onSettings={
            tv
              ? undefined
              : () => {
                  source.answerNotice(false);
                  void exit();
                  openSettings("sources");
                }
          }
        />
      )}

      {airplay.casting && (
        <div className="player-casting">
          {meta?.background && <Img className="player-status-bg" src={meta.background} alt="" />}
          <div className="player-status-content">
            <Cast size={40} />
            <p className="t-title2">Playing on AirPlay</p>
            <p className="t-callout player-casting-hint">To watch here again, choose this computer in the AirPlay list.</p>
            <Button variant="glass" onClick={airplay.pick}>
              AirPlay
            </Button>
          </div>
        </div>
      )}
      {notice && <div className="player-notice t-callout">{notice}</div>}
      {party && ready && started && <PartyHold party={party} videoId={videoId} />}
      {party && <PartyNotes party={party} />}

      {/* Top: back, what's playing, window-level controls. Drag lives here. */}
      <div className="player-top" data-tauri-drag-region>
        <IconButton variant="player" onClick={() => void exit()} label="Back" title="Back (Esc)">
          <ArrowLeft size={26} />
        </IconButton>
        <div className="player-heading" data-tauri-drag-region>
          <span className="player-heading-title">{heading}</span>
          {current && <span className="player-heading-show">{title}</span>}
        </div>
        <div className="player-top-actions">
          {party && <PartyBadge party={party} onOpen={() => setOptions("party")} />}
          <div className="player-volume">
            <IconButton variant="player" onClick={() => setMuted((m) => !m)} label={muted ? "Unmute" : "Mute"} title={withShortcut("Mute", "mute")}>
              <VolumeIcon size={22} />
            </IconButton>
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
          {airplay.available && (
            <IconButton variant="player" onClick={airplay.pick} label="AirPlay" title="AirPlay" aria-pressed={airplay.casting}>
              <Cast size={22} />
            </IconButton>
          )}
          {!tv && isDesktop && (
            <IconButton variant="player" onClick={() => void toggleFullscreen()} label="Fullscreen" title={withShortcut("Fullscreen", "fullscreen")}>
              {fullscreen ? <ExitFullscreen size={22} /> : <Fullscreen size={22} />}
            </IconButton>
          )}
          {!tv && !isDesktop && (
            <IconButton variant="player" onClick={toggleFill} label={fill ? "Fit to screen" : "Fill screen"} aria-pressed={fill}>
              {fill ? <ExitFullscreen size={22} /> : <Fullscreen size={22} />}
            </IconButton>
          )}
        </div>
        {!fullscreen && !tv && <WindowControls />}
      </div>

      {/* Centre transport, Netflix-style: bare glyphs, no button chrome. */}
      {ready && started && (
        <div className="player-center">
          <SkipTransport
            direction="back"
            seconds={seekStep}
            kick={kicks.back}
            onSkip={() => (seekBy(-seekStep), kick("back"))}
            label={`Back ${seekStep} seconds`}
            title={withShortcut(`Back ${seekStep}s`, "seekBack")}
          />
          <IconButton variant="transport" className="player-transport-main" onClick={togglePlay} label={paused ? "Play" : "Pause"} title={withShortcut("Play/Pause", "playPause")}>
            {buffering ? (
              <Spinner className="player-spinner" size={52} label="Buffering" />
            ) : paused ? (
              <Play size={64} fill="currentColor" strokeWidth={0} />
            ) : (
              <Pause size={64} fill="currentColor" strokeWidth={0} />
            )}
          </IconButton>
          <SkipTransport
            direction="forward"
            seconds={seekStep}
            kick={kicks.forward}
            onSkip={() => (seekBy(seekStep), kick("forward"))}
            label={`Forward ${seekStep} seconds`}
            title={withShortcut(`Forward ${seekStep}s`, "seekForward")}
          />
        </div>
      )}

      {/* Bottom: timeline with time left, then labelled text actions. */}
      <div
        className="player-bottom"
        onPointerEnter={() => (overControls.current = true)}
        onPointerLeave={() => (overControls.current = false)}
      >
        <div className="player-timeline">
          <Scrubber media={media} previews={seekTrack} span={skip.segments?.intro} onSeek={seekTo} />
          <PlayerClock media={media} display={timeDisplay} rate={rate} onCycle={cycleClock} />
        </div>
        <div className="player-actions">
          {!party && (
            <ActionButton icon={<Speed size={22} />} label={`Speed (${rate}x)`} glyph={pad("speed")} onClick={(el) => openOptions("speed", el)} />
          )}
          {type === "series" && (
            <ActionButton icon={<Episodes size={22} />} label="Episodes" glyph={pad("episodes")} onClick={() => setOptions("episodes")} />
          )}
          <ActionButton icon={<Captions size={22} />} label="Subtitles & Audio" glyph={pad("tracks")} onClick={(el) => openOptions("tracks", el)} />
          {!link && !local && <ActionButton icon={<Sources size={22} />} label="Sources" glyph={pad("sources")} onClick={() => setOptions("sources")} />}
          {canParty && !airplay.casting && (
            <ActionButton
              icon={<WatchParty size={22} />}
              label={party ? `Watch Party (${party.members.length})` : "Watch Party"}
              onClick={() => setOptions("party")}
            />
          )}
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
            options: SPEEDS.map((r) => ({ id: String(r), label: speedLabel(r) })),
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
              <IconButton
                variant="panel"
                aria-pressed={subSettingsOpen}
                label="Subtitle settings"
                title="Subtitle settings"
                onClick={() => setSubSettingsOpen((v) => !v)}
              >
                <Cog size={19} strokeWidth={2.1} />
              </IconButton>
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

      {tv && <VolumeHud volume={volume} muted={muted} ping={volumePing} media={media} />}

      <SkipButton
        active={started ? skip.active : null}
        onSkip={skip.skipActive}
        chromeVisible={chromeVisible}
        countdown={skip.countdown}
        paused={paused}
        onCountdownEnd={skip.finishCountdown}
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
              <Img src={stillFor(next.id) ?? next.thumbnail ?? meta?.background} alt="" />
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
                <Button
                  variant="primary"
                  className="next-up-play"
                  onClick={() => {
                    resetAutoplay();
                    playVideo(next.id);
                  }}
                >
                  {ended && willAutoplay && (
                    <span className="next-up-countdown" style={{ animationDuration: `${countdown}s` }} />
                  )}
                  {pad("skipOrNext", "nextEpisode") ?? <Play size={16} fill="currentColor" />} {ended && stillWatching ? "Keep Watching" : "Play Now"}
                </Button>
                <IconButton variant="glass" className="next-up-dismiss" onClick={() => setNextDismissed(true)} label="Dismiss">
                  <Close size={16} />
                </IconButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {canParty && (
        <OptionsOverlay
          open={options === "party"}
          onClose={() => setOptions(null)}
          media={media}
          columns={[
            ...(party
              ? [
                  {
                    title: "Watch Party",
                    size: "medium" as const,
                    options: [],
                    onSelect: () => {},
                    content: (
                      <div className="party-pane-stack">
                        <PartyInvite party={party} leave={false} />
                        <PartyActions party={party} onGo={() => setOptions(null)} />
                      </div>
                    ),
                  },
                  { title: "Watching", size: "medium" as const, options: [], onSelect: () => {}, content: <PartyMembers party={party} /> },
                  ...(party.hostId === party.me
                    ? [{ title: "Host", size: "medium" as const, options: [], onSelect: () => {}, content: <PartyHostControls party={party} /> }]
                    : []),
                ]
              : [{ title: "Watch Party", size: "medium" as const, options: [], onSelect: () => {}, content: <PartyStart me={profile!} onStart={local ? undefined : startHere} /> }]),
            // TV mode: no pasting on a remote; links others put on still play there.
            ...(tv
              ? []
              : [
                  {
                    title: "Watch a Link",
                    size: "medium" as const,
                    options: [],
                    onSelect: () => {},
                    content: (
                      <div className="party-pane">
                        <p className="party-lede">
                          {party ? "Put a video file or stream from the web on for everyone." : "Start a party on a video file or stream from the web."}{" "}
                          Everyone's app opens the link itself, after seeing it.
                        </p>
                        <LinkForm me={profile!} onDone={() => setOptions(null)} />
                      </div>
                    ),
                  },
                ]),
          ]}
        />
      )}

      <OptionsOverlay
        open={options === "episodes"}
        onClose={() => setOptions(null)}
        media={media}
        columns={
          episodeLayout === "list" || !meta
            ? [
                {
                  title: "Seasons",
                  value: String(shownSeason),
                  options: seasons.map((n) => ({ id: String(n), label: seasonLabel(n) })),
                  onSelect: (id) => setPickSeason(Number(id)), // browse; playback continues
                },
                {
                  title: "Episodes",
                  size: "wide",
                  header: meta && layoutSwitch,
                  value: videoId,
                  options: episodeItems,
                  onSelect: (id) => id !== videoId && playVideo(id),
                },
              ]
            : // The season to browse in a dropdown, its episodes side by side under it.
              [
                {
                  title: "Episodes",
                  size: "full",
                  titleHidden: true,
                  header: (
                    <div className="episode-rail-head">
                      <Dropdown
                        label="Season"
                        size="large"
                        value={String(shownSeason)}
                        onChange={(id) => setPickSeason(Number(id))} // browse; playback continues
                        options={seasons.map((n) => ({ value: String(n), label: seasonLabel(n) }))}
                      />
                      {layoutSwitch}
                    </div>
                  ),
                  options: [],
                  onSelect: () => {},
                  content: (
                    <EpisodeRail
                      meta={meta}
                      episodes={meta.videos.filter((v) => v.season === shownSeason)}
                      playing={videoId}
                      progress={progressById}
                      still={(v) => stillFor(v.id) ?? v.thumbnail}
                      onPlay={(id) => {
                        setOptions(null);
                        playVideo(id);
                      }}
                    />
                  ),
                },
              ]
        }
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
            value: currentSource,
            options: sourceOptions,
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
              if (id === currentSource) return;
              if (id === DOWNLOADED) return downloaded && playVideo(videoId, downloaded);
              const pick = rankedStreams[Number(id)];
              if (pick) playVideo(videoId, pick.stream);
            },
          },
        ]}
      />
      {sourceMenu && (
        <TvSourceMenu
          anchor={sourceMenu.anchor}
          onClose={() => {
            setSourceMenu(null);
            sourceMenu.anchor.focus({ preventScroll: true });
          }}
          onInfo={() => {
            setSourceMenu(null);
            showSourceInfoRef.current(sourceMenu.r, sourceMenu.anchor);
          }}
          onPlay={() => {
            setSourceMenu(null);
            if (streamKey(sourceMenu.r) !== currentKey) playVideo(videoId, sourceMenu.r.stream);
          }}
        />
      )}
      {sourceInfo.panel}
    </div>
  );
}

/** The Sources row of this video's finished download (#23); the others are indexes into the ranked list. */
const DOWNLOADED = "downloaded";

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
  /** Gets the button, for a menu that opens from it. */
  onClick: (el: HTMLButtonElement) => void;
}) {
  return (
    // Named by its label even where the label isn't drawn (a phone held upright shows the glyphs alone).
    <button className="player-action pressable" onClick={(e) => onClick(e.currentTarget)} aria-label={label} title={label}>
      {icon}
      <span aria-hidden>{label}</span>
      {glyph}
    </button>
  );
}

/** The volume last set, 0–1 (1 when none was, or it isn't a number). */
function savedVolume() {
  const v = Number(localStorage.getItem("polar.volume") ?? 1);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

/** A short message over the player (a source skipped, an intro skipped) that clears itself. */
function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<number>(undefined);
  const flash = useCallback((text: string, ms: number) => {
    window.clearTimeout(timer.current);
    setNotice(text);
    timer.current = window.setTimeout(() => setNotice(null), ms);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [notice, flash] as const;
}
