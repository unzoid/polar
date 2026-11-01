import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { ContentType, SubtitleOption } from "../../lib/types";
import { ISO3, langMatches, languageName } from "../../lib/languages";
import { isMpv, type MediaLike, type MpvTrack } from "./mpvMedia";

export interface TrackOption {
  id: string;
  label: string;
}

const OFF = "off";

export { languageName };

/** Normalised ISO 639-1 form of a track/addon language code, for saving as a preference. */
const norm = (code?: string) => (code ? (ISO3[code.toLowerCase()] ?? code) : "");

// HTMLMediaElement.audioTracks: enabled in WebView2 via
// `--enable-blink-features=AudioVideoTracks` (see tauri.conf.json).
interface AudioTrackLike {
  id: string;
  label: string;
  language: string;
  enabled: boolean;
}
type AudioTrackListLike = ArrayLike<AudioTrackLike> & EventTarget;

/**
 * Audio and subtitle tracks for the current video:
 *  - audio: the file's own tracks (when the engine exposes them);
 *  - subtitles: tracks embedded in the file, plus every subtitle addon's files
 *    (one per language), converted to WebVTT in Rust.
 * Preferred languages (Settings) are applied automatically once the tracks are
 * known; choosing a track here updates that preference, so the next episode
 * starts the same way.
 *
 * With the mpv engine, tracks come from mpv's own track-list — so embedded
 * subtitles (SRT/ASS/PGS in MKV) and every audio track are real — and addon
 * subtitles are handed to mpv with `sub-add` (it fetches SRT itself).
 */
export interface TrackPrefs {
  audio: string;
  subtitle: string;
}

export function useTracks(
  media: MediaLike | null,
  type: ContentType,
  videoId: string,
  prefs: TrackPrefs,
  onPrefChange: (patch: { audioLanguage?: string; subtitleLanguage?: string }) => void,
) {
  const video = media instanceof HTMLVideoElement ? media : null;
  const mpv = isMpv(media) ? media : null;
  const [mpvLoaded, setMpvLoaded] = useState(false);
  const [audio, setAudio] = useState<TrackOption[]>([]);
  const [audioId, setAudioId] = useState<string>();
  const [embedded, setEmbedded] = useState<TrackOption[]>([]);
  const [subId, setSubId] = useState<string>(OFF);
  const userChose = useRef(false);
  const audioChose = useRef(false);
  const appliedAudio = useRef(false);
  const appliedSub = useRef(false);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const onPrefRef = useRef(onPrefChange);
  onPrefRef.current = onPrefChange;

  const external = useQuery({
    queryKey: ["subtitles", type, videoId],
    queryFn: () => api.subtitles(type, videoId),
    staleTime: 30 * 60_000,
  });

  /** One entry per language, in a stable, readable order. */
  const externalByLang = useMemo(() => {
    const seen = new Map<string, SubtitleOption>();
    for (const s of external.data ?? []) if (!seen.has(s.lang)) seen.set(s.lang, s);
    return [...seen.values()].sort((a, b) => (languageName(a.lang) ?? a.lang).localeCompare(languageName(b.lang) ?? b.lang));
  }, [external.data]);
  const externalByLangRef = useRef(externalByLang);
  externalByLangRef.current = externalByLang;

  // mpv: mirror its track-list and current aid/sid.
  useEffect(() => {
    if (!mpv) return;
    const read = () => {
      const audioTracks = mpv.tracks.filter((t) => t.type === "audio");
      setAudio(audioTracks.map((t) => ({ id: String(t.id), label: mpvLabel(t) })));
      setAudioId(typeof mpv.aid === "number" ? String(mpv.aid) : undefined);
      setEmbedded(
        mpv.tracks
          .filter((t) => t.type === "sub" && !t.external)
          .map((t) => ({ id: `emb:${t.id}`, label: mpvLabel(t) })),
      );
      const sel = mpv.tracks.find((t) => t.type === "sub" && t.id === mpv.sid);
      if (!sel) setSubId(OFF);
      else if (!sel.external) setSubId(`emb:${sel.id}`);
      else {
        const ext = externalByLangRef.current.find((x) => x.url === sel["external-filename"]);
        if (ext) setSubId(`ext:${ext.lang}`);
      }
    };
    const onLoaded = () => setMpvLoaded(true);
    read();
    mpv.addEventListener("tracks", read);
    mpv.addEventListener("loadedmetadata", onLoaded);
    return () => {
      mpv.removeEventListener("tracks", read);
      mpv.removeEventListener("loadedmetadata", onLoaded);
    };
  }, [mpv]);

  // Track lists appear after metadata loads and can change; listen for both.
  useEffect(() => {
    if (!video) return;
    const read = () => {
      const list = (video as unknown as { audioTracks?: AudioTrackListLike }).audioTracks;
      if (list) {
        const items = Array.from(list);
        setAudio(
          items.map((t, i) => ({
            id: t.id || String(i),
            label: t.label || languageName(t.language) || `Track ${i + 1}`,
          })),
        );
        const on = items.findIndex((t) => t.enabled);
        if (on >= 0) setAudioId(items[on].id || String(on));
      }
      setEmbedded(
        Array.from(video.textTracks)
          .filter((t) => !t.id.startsWith("ext:"))
          .map((t, i) => ({ id: `emb:${i}`, label: t.label || languageName(t.language) || `Subtitle ${i + 1}` })),
      );
    };
    read();
    const audioList = (video as unknown as { audioTracks?: AudioTrackListLike }).audioTracks;
    video.addEventListener("loadedmetadata", read);
    video.textTracks.addEventListener("addtrack", read);
    audioList?.addEventListener("addtrack", read);
    audioList?.addEventListener("change", read);
    return () => {
      video.removeEventListener("loadedmetadata", read);
      video.textTracks.removeEventListener("addtrack", read);
      audioList?.removeEventListener("addtrack", read);
      audioList?.removeEventListener("change", read);
    };
  }, [video]);

  const selectAudio = useCallback(
    (id: string, remember = true) => {
      if (remember) audioChose.current = true;
      if (mpv) {
        if (id === "default") return;
        audioChose.current = true;
        void mpv.set("aid", Number(id));
        const lang = mpv.tracks.find((t) => t.id === Number(id) && t.type === "audio")?.lang;
        if (lang && remember) onPrefRef.current({ audioLanguage: norm(lang) });
        setAudioId(id);
        return;
      }
      const list = (video as unknown as { audioTracks?: AudioTrackListLike })?.audioTracks;
      if (!list) return;
      Array.from(list).forEach((t, i) => {
        const tid = t.id || String(i);
        t.enabled = tid === id;
        if (tid === id && t.language && remember) onPrefRef.current({ audioLanguage: norm(t.language) });
      });
      setAudioId(id);
    },
    [video, mpv],
  );

  const selectSubtitle = useCallback(
    async (id: string, remember = true) => {
      if (remember) userChose.current = true;
      if (mpv) {
        setSubId(id);
        if (id === OFF) void mpv.set("sid", "no");
        else if (id.startsWith("emb:")) void mpv.set("sid", Number(id.slice(4)));
        else {
          const sub = externalByLang.find((x) => `ext:${x.lang}` === id);
          if (!sub) return;
          const loaded = mpv.tracks.find((t) => t.type === "sub" && t["external-filename"] === sub.url);
          if (loaded) void mpv.set("sid", loaded.id);
          else await mpv.command("sub-add", sub.url, "select", languageName(sub.lang) ?? sub.lang, ISO3[sub.lang] ?? sub.lang).catch(() => {});
        }
        if (remember) {
          const lang =
            id === OFF
              ? ""
              : id.startsWith("emb:")
                ? norm(mpv.tracks.find((t) => t.type === "sub" && t.id === Number(id.slice(4)))?.lang)
                : norm(id.slice(4));
          onPrefRef.current({ subtitleLanguage: lang });
        }
        return;
      }
      if (!video) return;
      setSubId(id);
      const tracks = Array.from(video.textTracks);
      let target: TextTrack | undefined;

      if (id.startsWith("ext:")) {
        target = tracks.find((t) => t.id === id);
        if (!target) {
          const sub = externalByLang.find((s) => `ext:${s.lang}` === id);
          if (!sub) return;
          const vtt = await api.subtitleVtt(sub.url);
          const el = document.createElement("track");
          el.kind = "subtitles";
          el.id = id;
          el.label = languageName(sub.lang) ?? sub.lang;
          el.srclang = ISO3[sub.lang] ?? sub.lang;
          el.src = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
          video.appendChild(el);
          target = el.track;
        }
      } else if (id.startsWith("emb:")) {
        target = tracks.filter((t) => !t.id.startsWith("ext:"))[Number(id.slice(4))];
      }

      for (const t of Array.from(video.textTracks)) t.mode = t === target ? "showing" : "disabled";
      if (remember) {
        onPrefRef.current({ subtitleLanguage: id === OFF ? "" : norm(target?.language || id.slice(4)) });
      }
    },
    [video, mpv, externalByLang],
  );

  // Apply the preferred audio language once, as soon as the file's tracks are known
  // (unless the user already picked one for this video).
  useEffect(() => {
    if (appliedAudio.current || audioChose.current || !prefs.audio) return;
    if (!(video || (mpv && mpvLoaded))) return;
    const tracks: { id: string; lang?: string }[] = mpv
      ? mpv.tracks.filter((t) => t.type === "audio").map((t) => ({ id: String(t.id), lang: t.lang }))
      : Array.from(((video as unknown as { audioTracks?: AudioTrackListLike })?.audioTracks ?? []) as ArrayLike<AudioTrackLike>).map((t, i) => ({
          id: t.id || String(i),
          lang: t.language,
        }));
    if (!tracks.length) return;
    appliedAudio.current = true;
    const match = tracks.find((t) => langMatches(t.lang, prefs.audio));
    if (match && match.id !== audioId) selectAudio(match.id, false);
  }, [prefs.audio, video, mpv, mpvLoaded, audio, audioId, selectAudio]);

  // Same for subtitles: a track inside the file wins (it's timed to this exact
  // release); otherwise an addon's subtitles in that language. Empty = off.
  useEffect(() => {
    if (appliedSub.current || userChose.current || !prefs.subtitle) return;
    if (!(video || (mpv && mpvLoaded))) return;
    const embeddedMatch = mpv
      ? mpv.tracks.find((t) => t.type === "sub" && !t.external && langMatches(t.lang, prefs.subtitle))
      : Array.from(video!.textTracks).find((t) => !t.id.startsWith("ext:") && langMatches(t.language, prefs.subtitle));
    if (embeddedMatch) {
      appliedSub.current = true;
      const idx = mpv ? (embeddedMatch as MpvTrack).id : Array.from(video!.textTracks).indexOf(embeddedMatch as TextTrack);
      void selectSubtitle(`emb:${idx}`, false);
      return;
    }
    // External subtitles arrive asynchronously; wait for them before giving up.
    if (external.isLoading) return;
    appliedSub.current = true;
    const ext = externalByLang.find((x) => langMatches(x.lang, prefs.subtitle));
    if (ext) void selectSubtitle(`ext:${ext.lang}`, false);
  }, [prefs.subtitle, video, mpv, mpvLoaded, embedded, externalByLang, external.isLoading, selectSubtitle]);

  // Blob URLs belong to this video only.
  useEffect(
    () => () => {
      video?.querySelectorAll("track").forEach((t) => {
        URL.revokeObjectURL(t.src);
        t.remove();
      });
    },
    [video],
  );

  const subtitles: TrackOption[] = [
    { id: OFF, label: "Off" },
    ...embedded,
    ...externalByLang.map((s) => ({ id: `ext:${s.lang}`, label: languageName(s.lang) ?? s.lang })),
  ];

  return {
    audio,
    audioId,
    selectAudio,
    subtitles,
    subId,
    selectSubtitle,
    subtitlesLoading: external.isLoading,
  };
}

/** "English · 5.1", "Commentary", "Japanese (Signs)". */
function mpvLabel(t: MpvTrack) {
  const name = t.title || languageName(t.lang) || `Track ${t.id}`;
  const ch = t["demux-channel-count"];
  const layout = ch === 6 ? "5.1" : ch === 8 ? "7.1" : ch === 2 ? "Stereo" : ch === 1 ? "Mono" : undefined;
  const lang = t.title && t.lang ? languageName(t.lang) : undefined;
  return [name, lang && lang !== name ? lang : undefined, layout].filter(Boolean).join(" · ");
}
