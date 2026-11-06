import { describe, expect, test } from "bun:test";
import { backdropLuminance, chooseLogo, contrast, DARK_PAGE, logoLook, measureInk, pickLogo, type Ink } from "../src/lib/ui/logoContrast";

type Rgb = [number, number, number];

/** RGBA pixels: `n` of each colour (a grey level or [r, g, b]) with its alpha (default opaque). */
function pixels(...runs: [n: number, colour: number | Rgb, alpha?: number][]) {
  const out: number[] = [];
  for (const [n, colour, alpha = 255] of runs) {
    const [r, g, b] = typeof colour === "number" ? [colour, colour, colour] : colour;
    for (let i = 0; i < n; i++) out.push(r, g, b, alpha);
  }
  return new Uint8ClampedArray(out);
}

const ink = (...runs: Parameters<typeof pixels>) => measureInk(pixels(...runs)) as Ink;
/** A dark backdrop under the hero's gradient, and a pale one (a snowfield, a white wall) under the same. */
const dark = backdropLuminance(pixels([200, [40, 34, 30]]), 0.5);
const light = backdropLuminance(pixels([200, [235, 232, 228]]), 0.2);

describe("logoLook", () => {
  test("a black logo on a dark backdrop becomes the white silhouette", () => {
    expect(logoLook(ink([400, 10], [600, 0, 0]), dark)).toBe("silhouette");
    // Anti-aliased edges and a few lighter specks don't change that.
    expect(logoLook(ink([380, 12], [10, 160], [10, 200, 140], [600, 0, 0]), dark)).toBe("silhouette");
  });

  test("a dark grey, textured logo (above the old 0.22 average) becomes the silhouette too", () => {
    expect(logoLook(ink([150, 50], [150, 70], [150, 85], [50, 100]), dark)).toBe("silhouette");
  });

  test("a black logo with a thin white outline (over 5% bright ink) becomes the silhouette", () => {
    expect(logoLook(ink([880, 6], [120, 245]), dark)).toBe("silhouette");
  });

  test("a multicolour logo with bright details gets a light halo, keeping its artwork", () => {
    const multicolour = ink([300, [90, 10, 10]], [300, [10, 20, 80]], [100, [250, 210, 40]], [80, 240]);
    expect(logoLook(multicolour, dark)).toBe("halo-light");
  });

  test("#11: a dark disc carrying bright letters keeps its artwork (no silhouette)", () => {
    expect(logoLook(ink([800, 8], [200, 235], [1000, 0, 0]), dark)).not.toBe("silhouette");
  });

  test("a light logo on a light backdrop gets a dark halo", () => {
    expect(logoLook(ink([500, 225]), light)).toBe("halo-dark");
  });

  test("logos that read stay as they are", () => {
    expect(logoLook(ink([500, 240]), dark)).toBe("as-is");
    expect(logoLook(ink([500, 240]), DARK_PAGE)).toBe("as-is");
    // A white logo with a heavy black outline still reads.
    expect(logoLook(ink([550, 250], [450, 0]), dark)).toBe("as-is");
    // A black logo on a pale backdrop reads.
    expect(logoLook(ink([500, 5]), light)).toBe("as-is");
    expect(logoLook(ink([500, [250, 200, 30]]), dark)).toBe("as-is");
  });

  test("nothing opaque is nothing to measure", () => {
    expect(measureInk(pixels([500, 0, 0]))).toBeNull();
  });
});

describe("backdropLuminance", () => {
  test("the page's gradient darkens the picture behind the logo", () => {
    const white = pixels([10, 255]);
    expect(backdropLuminance(white, 0)).toBeCloseTo(1, 5);
    expect(backdropLuminance(white, 0.7)).toBeLessThan(0.2);
    expect(backdropLuminance(white, 1)).toBeCloseTo(DARK_PAGE, 5);
    expect(backdropLuminance(new Uint8ClampedArray(), 0.5)).toBe(DARK_PAGE);
  });

  test("contrast is WCAG's ratio", () => {
    expect(contrast(1, 0)).toBeCloseTo(21, 5);
    expect(contrast(0.5, 0.5)).toBe(1);
  });
});

describe("pickLogo", () => {
  const black = ink([500, 0]);
  const white = ink([500, 245]);

  test("the first logo that reads is chosen, keeping the metadata language's order", () => {
    expect(pickLogo([black, white, ink([500, 230])], dark)).toEqual({ index: 1, look: "as-is" });
    expect(pickLogo([white, black], dark)).toEqual({ index: 0, look: "as-is" });
    expect(pickLogo([black, white], light)).toEqual({ index: 0, look: "as-is" });
  });

  test("when none reads, the first is kept and treated", () => {
    expect(pickLogo([black, ink([500, 20])], dark)).toEqual({ index: 0, look: "silhouette" });
  });

  test("logos that couldn't be measured are passed over; none measured is null", () => {
    expect(pickLogo([null, black], dark)).toEqual({ index: 1, look: "silhouette" });
    expect(pickLogo([null, white], dark)).toEqual({ index: 1, look: "as-is" });
    expect(pickLogo([null, null], dark)).toBeNull();
  });
});

describe("chooseLogo", () => {
  const black = ink([500, 0]);
  const white = ink([500, 245]);
  const logos = ["https://media.example.com/en.png", "https://media.example.com/white.png"];

  test("shows the logo that reads, or the first treated", () => {
    expect(chooseLogo(logos, [black, white], dark)).toEqual({ src: logos[1], look: "as-is" });
    expect(chooseLogo(logos, [black, null], dark)).toEqual({ src: logos[0], look: "silhouette" });
    // The backdrop couldn't be measured: the dark page is assumed.
    expect(chooseLogo(logos, [black, null], null)).toEqual({ src: logos[0], look: "silhouette" });
  });

  test("neither the logos nor the backdrop measured: unsure, so the name shows", () => {
    expect(chooseLogo(logos, [null, null], null)).toBe("unsure");
  });

  test("an unmeasured logo with no backdrop to measure is left as it is", () => {
    expect(chooseLogo(logos.slice(0, 1), [null], DARK_PAGE)).toEqual({ src: logos[0], look: "as-is" });
    expect(chooseLogo(logos.slice(0, 1), [null], dark)).toEqual({ src: logos[0], look: "as-is" });
  });
});
