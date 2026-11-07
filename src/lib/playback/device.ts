import { useEffect, useState } from "react";
import type { Device } from "./bestMatch";

/**
 * What this device can show and decode, for Best Match (#230). The screen's HDR
 * from the `dynamic-range` media query; hardware decoding of HEVC and AV1 from
 * the WebView's Media Capabilities (a power-efficient decode is a hardware one).
 * mpv uses the same GPU when Settings → Advanced's hardware decoding is on, and
 * shows Dolby Vision itself; the built-in player only where the system says so.
 * What can't be told stays `null`, worth no points either way.
 */

type Caps = Pick<Device, "hdr" | "dolbyVision" | "hevc" | "av1">;
/** What the system said it decodes. */
type System = Omit<Caps, "hdr">;
type Engine = "mpv" | "html";

const CODECS = {
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.90"',
  av1: 'video/mp4; codecs="av01.0.08M.08"',
  dolbyVision: 'video/mp4; codecs="dvh1.05.06"',
} as const;

/** Whether the system decodes this, in hardware; null when it can't say. */
async function decodes(contentType: string): Promise<{ supported: boolean; hardware: boolean } | null> {
  const mc = (navigator as { mediaCapabilities?: MediaCapabilities }).mediaCapabilities;
  if (!mc?.decodingInfo) return null;
  try {
    const info = await mc.decodingInfo({
      type: "file",
      video: { contentType, width: 1920, height: 1080, bitrate: 8_000_000, framerate: 24 },
    });
    return { supported: info.supported, hardware: info.supported && info.powerEfficient };
  } catch {
    return null;
  }
}

/** The display shows HDR. */
function hdrScreen(): boolean | null {
  if (typeof matchMedia !== "function") return null;
  return matchMedia("(dynamic-range: high)").matches;
}

let probed: Promise<System> | undefined;
const probe = () =>
  (probed ??= Promise.all([decodes(CODECS.hevc), decodes(CODECS.av1), decodes(CODECS.dolbyVision)]).then(([hevc, av1, dv]) => ({
    hevc: hevc ? hevc.hardware : null,
    av1: av1 ? av1.hardware : null,
    dolbyVision: dv ? dv.supported : null,
  })));

/** The capabilities for an engine, from what the system said. */
export function deviceCaps(
  engine: Engine | null,
  hwdec: boolean,
  system: System,
  hdr: boolean | null,
): Caps {
  // mpv with hardware decoding off decodes everything in software.
  const hw = (v: boolean | null) => (engine === "mpv" && !hwdec ? false : v);
  return {
    hdr,
    dolbyVision: engine === "mpv" ? true : engine === "html" ? system.dolbyVision : null,
    hevc: hw(system.hevc),
    av1: hw(system.av1),
  };
}

const UNKNOWN: System = { hevc: null, av1: null, dolbyVision: null };

/** This device's capabilities, once the system has answered (unknown until then). */
export function useDeviceCaps(engine: Engine | null, hwdec: boolean): Caps {
  const [system, setSystem] = useState(UNKNOWN);
  useEffect(() => {
    let live = true;
    void probe().then((s) => live && setSystem(s));
    return () => void (live = false);
  }, []);
  return deviceCaps(engine, hwdec, system, hdrScreen());
}
