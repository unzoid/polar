import { useEffect, useState } from "react";
import { AirPlayCast, airPlaySupported, castableUrl, type CastState } from "./airplay";
import type { MediaLike } from "./mpvMedia";

const IDLE: CastState = { available: false, casting: false };

/**
 * AirPlay for the playing link (see airplay.ts). `media` is what plays in the
 * app; `video` is the built-in player's element, when that's the engine. Off
 * (no button) when `enabled` is false, as in a watch party.
 *
 * Returns the cast state, `media` to drive while casting with mpv (the hidden
 * element), and `pick` for the AirPlay button.
 */
export function useAirPlay({
  media,
  video,
  url,
  headers,
  enabled,
}: {
  media: MediaLike | null;
  video: HTMLVideoElement | null;
  url?: string;
  headers?: Record<string, string> | null;
  enabled: boolean;
}) {
  const [cast, setCast] = useState<AirPlayCast | null>(null);
  const [state, setState] = useState<CastState>(IDLE);
  const on = enabled && !!media && !!url && airPlaySupported() && castableUrl(url, headers);

  useEffect(() => {
    if (!on || !media) return;
    // The built-in player sends its own element; mpv gets a hidden one holding the same link.
    const own = !video;
    const el = video ?? document.createElement("video");
    if (own) {
      el.hidden = true;
      el.playsInline = true;
      document.body.append(el);
    }
    const c = new AirPlayCast(media, el, own ? url : undefined);
    const onChange = () => setState(c.current);
    c.addEventListener("change", onChange);
    setCast(c);
    return () => {
      c.removeEventListener("change", onChange);
      c.dispose();
      if (own) el.remove();
      setCast(null);
      setState(IDLE);
    };
  }, [on, media, video, url]);

  return {
    ...state,
    media: state.casting ? (cast?.media ?? null) : null,
    pick: () => cast?.pick(),
  };
}
