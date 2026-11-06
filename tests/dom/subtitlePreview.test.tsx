import { expect, test } from "bun:test";
import { act } from "react";
import { DEFAULT_SUBTITLE_STYLE, SubtitlePreview } from "../../src/components/player/SubtitleSettings";
import { MpvMedia } from "../../src/components/player/mpvMedia";
import { render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

/** An mpv that answers get_property from `props`, recording what was asked. */
function fakeMpv(props: Record<string, unknown>) {
  const asked: string[] = [];
  const mpv = Object.create(MpvMedia.prototype) as MpvMedia;
  mpv.command = async (...args: unknown[]) => {
    const name = String(args[1]);
    asked.push(name);
    if (!(name in props)) throw new Error("unknown property");
    return props[name];
  };
  return { mpv, asked };
}

const px = (el: HTMLElement, name: string) => parseFloat(el.style.getPropertyValue(name));

test("with mpv, the preview takes its size from mpv's options and window, not a fixed guess (#228)", async () => {
  const h = window.innerHeight;
  const osd = { w: 1920, h: 1080, mt: 138, mb: 138, ml: 0, mr: 0 };
  const { mpv, asked } = fakeMpv({ "osd-dimensions": osd, "sub-font-size": 50, "sub-text": "A line on screen" });
  const { container, unmount } = await render(<SubtitlePreview style={{ ...DEFAULT_SUBTITLE_STYLE, size: 150 }} media={mpv} />);
  await settle();
  const preview = container.querySelector<HTMLElement>(".sub-preview")!;
  expect(asked).toContain("osd-dimensions");
  expect(asked).toContain("sub-margin-y");
  expect(container.textContent).toBe("A line on screen");
  // 50 on the 720-line canvas × sub-scale 1.5, on a window shown h CSS pixels high.
  expect(px(preview, "--sub-line")).toBeCloseTo((50 * 1.5 * h) / 720, 3);
  // The outline grows with sub-scale too, and is drawn as a stroke twice as wide.
  expect(px(preview, "--sub-stroke")).toBeCloseTo((2 * 1.6 * 1.5 * h) / 720, 3);
  expect(preview.dataset.engine).toBe("mpv");
  await unmount();
});

test("without mpv, the preview follows the built-in player's ::cue size", async () => {
  const { container, unmount } = await render(<SubtitlePreview style={{ ...DEFAULT_SUBTITLE_STYLE, size: 200 }} media={null} />);
  const preview = container.querySelector<HTMLElement>(".sub-preview")!;
  const expected = Math.min(Math.max(20, 0.024 * window.innerWidth), 36) * 2;
  expect(px(preview, "--sub-size")).toBeCloseTo(expected, 3);
  expect(px(preview, "--sub-line")).toBeCloseTo(expected * 1.25, 3);
  expect(preview.dataset.engine).toBe("built-in");
  await unmount();
});
