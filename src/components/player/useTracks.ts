import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { ContentType, SubtitleOption } from "../../lib/types";
import { isMpv, type MediaLike, type MpvTrack } from "./mpvMedia";

export interface TrackOption {
  id: string;
  label: string;
}

const PREF_SUB = "rustio.subtitleLang";
const PREF_AUDIO = "rustio.audioLang";
const OFF = "off";

const names = new Intl.DisplayNames(undefined, { type: "language" });
/** ISO 639-2 codes addons use (`eng`, `pob`) → 639-1 where we know them. */
const ISO3: Record<string, string> = {
  eng: "en", spa: "es", spn: "es", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", por: "pt", pob: "pt-BR",
  dut: "nl", nld: "nl", pol: "pl", rus: "ru", tur: "tr", ara: "ar", heb: "he", jpn: "ja", kor: "ko", chi: "zh",
  zho: "zh", swe: "sv", dan: "da", nor: "no", fin: "fi", gre: "el", ell: "el", hun: "hu", cze: "cs", ces: "cs",
  rum: "ro", ron: "ro", ukr: "uk", vie: "vi", tha: "th", ind: "id", hin: "hi", per: "fa", fas: "fa", bul: "bg",
  hrv: "hr", srp: "sr", slv: "sl", slo: "sk", slk: "sk", may: "ms", msa: "ms",
};
export function languageName(code?: string) {
  if (!code || code === "und") return undefined;
  const norm = ISO3[code.toLowerCase()] ?? code;
  try {
    return names.of(norm) ?? code;
  } catch {
    return code;
  }
}

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
 * The chosen languages are remembered, so the next episode starts the same way.
 *
 * With the mpv engine, tracks come from mpv's own track-list — so embedded
 * subtitles (SRT/ASS/PGS in MKV) and every audio track are real — and addon
 * subtitles are handed to mpv with `sub-add` (it fetches SRT itself).
 */
export function useTracks(media: MediaLike | null, type: ContentType, videoId: string) {
  const video = media instanceof HTMLVideoElement ? media : null;
  const mpv = isMpv(media) ? media : null;
  const [mpvLoaded, setMpvLoaded] = useState(false);
  const [audio, setAudio] = useState<TrackOption[]>([]);
  const [audioId, setAudioId] = useState<string>();
  const [embedded, setEmbedded] = useState<TrackOption[]>([]);
  const [subId, setSubId] = useState<string>(OFF);
  const userChose = useRef(false);

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
    (id: string) => {
      if (mpv) {
        if (id === "default") return;
        void mpv.set("aid", Number(id));
        const lang = mpv.tracks.find((t) => t.id === Number(id) && t.type === "audio")?.lang;
        if (lang) localStorage.setItem(PREF_AUDIO, lang);
        setAudioId(id);
        return;
      }
      const list = (video as unknown as { audioTracks?: AudioTrackListLike })?.audioTracks;
      if (!list) return;
      Array.from(list).forEach((t, i) => {
        const tid = t.id || String(i);
        t.enabled = tid === id;
        if (tid === id && t.language) localStorage.setItem(PREF_AUDIO, t.language);
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
        if (remember) localStorage.setItem(PREF_SUB, id === OFF ? OFF : id.slice(4));
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
      if (remember) localStorage.setItem(PREF_SUB, id === OFF ? OFF : (target?.language || id.slice(4)));
    },
    [video, mpv, externalByLang],
  );

  // Re-apply the remembered subtitle language once options are known.
  useEffect(() => {
    if (userChose.current || (!video && !(mpv && mpvLoaded))) return;
    const pref = localStorage.getItem(PREF_SUB);
    if (!pref || pref === OFF) return;
    const match = externalByLang.find((s) => s.lang === pref || ISO3[s.lang] === pref);
    if (match) void selectSubtitle(`ext:${match.lang}`, false);
  }, [externalByLang, video, mpv, mpvLoaded, selectSubtitle]);

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
