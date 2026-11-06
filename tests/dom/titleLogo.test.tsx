import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { TitleLogo } from "../../src/components/TitleLogo";
import { LOGO_SPOTS } from "../../src/lib/ui";
import { render } from "./render";

const BLACK = "https://media.example.com/black.png";
const WHITE = "https://media.example.com/white.png";
const BACKDROP = "https://media.example.com/backdrop.jpg";

/** Grey level each picture (by its measuring URL) is drawn in; absent = the host refuses it. */
let shades: Record<string, number> = {};
const realImage = globalThis.Image;
const realGetContext = HTMLCanvasElement.prototype.getContext;

/** Pictures for measuring load (or fail) on the next tick; the canvas reads them back as their grey. */
class FakeImage {
  crossOrigin = "";
  decoding = "";
  naturalWidth = 400;
  naturalHeight = 100;
  onload?: () => void;
  onerror?: () => void;
  shade?: number;
  set src(url: string) {
    const key = url.replace("?tone=1", "");
    setTimeout(() => (key in shades ? ((this.shade = shades[key]), this.onload?.()) : this.onerror?.()));
  }
}

beforeEach(() => {
  (globalThis as { Image: unknown }).Image = FakeImage;
  HTMLCanvasElement.prototype.getContext = function () {
    let shade = 0;
    return {
      drawImage: (img: FakeImage) => (shade = img.shade ?? 0),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : shade)) }),
    };
  } as unknown as typeof realGetContext;
});

afterEach(() => {
  (globalThis as { Image: unknown }).Image = realImage;
  HTMLCanvasElement.prototype.getContext = realGetContext;
  shades = {};
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

test("TitleLogo: shows the logo at once, then the one of the title's logos that reads on the backdrop (#215)", async () => {
  shades = { [BLACK]: 0, [WHITE]: 245, [BACKDROP]: 30 };
  const { container, unmount } = await render(<TitleLogo src={BLACK} logos={[BLACK, WHITE]} backdrop={BACKDROP} spot={LOGO_SPOTS.hero} alt="A Show" />);
  // Measuring never delays the visible logo.
  expect(container.querySelector("img")?.getAttribute("src")).toBe(BLACK);
  await settle();
  const img = container.querySelector("img");
  expect(img?.getAttribute("src")).toBe(WHITE);
  expect(img?.dataset.logoLook).toBeUndefined();
  await unmount();
});

test("TitleLogo: a lone black logo becomes the silhouette", async () => {
  shades = { [BLACK]: 0 };
  const { container, unmount } = await render(<TitleLogo src={BLACK} alt="A Show" />);
  await settle();
  expect(container.querySelector("img")?.dataset.logoLook).toBe("silhouette");
  await unmount();
});

test("TitleLogo: when neither the logo nor the backdrop can be measured, the caller shows the name", async () => {
  let failed = 0;
  const logo = "https://media.example.com/refused.png";
  const { container, unmount } = await render(
    <TitleLogo src={logo} backdrop="https://media.example.com/refused.jpg" spot={LOGO_SPOTS.detail} alt="A Show" onFail={() => failed++} />,
  );
  expect(container.querySelector("img")).not.toBeNull();
  await settle();
  expect(failed).toBe(1);
  expect(container.querySelector("img")).toBeNull();
  await unmount();
});
