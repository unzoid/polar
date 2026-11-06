import { expect, test } from "bun:test";
import { act } from "react";
import { ArtTitle, Card } from "../../src/components/title/Card";
import { TitleHeading } from "../../src/components/title/TitleHeading";
import { markImageLoaded, useArtGate } from "../../src/lib/ui";
import { render } from "./render";

const fire = (el: Element | null, type: "load" | "error") => act(async () => void el!.dispatchEvent(new Event(type)));

function landscape(art: string, logo?: string, artFallbacks?: string[]) {
  return (
    <Card shape="landscape" art={art} artFallbacks={artFallbacks} title="A Placeholder Film">
      <ArtTitle name="A Placeholder Film" logo={logo} />
    </Card>
  );
}

test("a card's logo waits for its art: pending until the art loads, then ready", async () => {
  const { container, unmount } = await render(landscape("https://media.example.com/gate-1.jpg", "https://media.example.com/gate-1-logo.png"));
  const frame = container.querySelector(".card-frame")!;
  const logo = container.querySelector(".card-logo")!;
  expect(frame.getAttribute("data-art")).toBe("pending");
  expect(logo.classList.contains("art-after")).toBe(true);
  expect(container.querySelector(".card-art-scrim")!.classList.contains("art-after")).toBe(true);
  // The logo loading first doesn't let it in.
  await fire(logo, "load");
  expect(frame.getAttribute("data-art")).toBe("pending");
  await fire(container.querySelector(".card-img"), "load");
  expect(frame.getAttribute("data-art")).toBe("ready");
  await unmount();
});

test("a card whose art fails shows its logo", async () => {
  const { container, unmount } = await render(landscape("https://media.example.com/gate-2.jpg", "https://media.example.com/gate-2-logo.png"));
  const frame = container.querySelector(".card-frame")!;
  expect(frame.getAttribute("data-art")).toBe("pending");
  await fire(container.querySelector(".card-img"), "error");
  expect(frame.getAttribute("data-art")).toBe("ready");
  expect(container.querySelector(".card-logo")).not.toBeNull();
  await unmount();
});

test("a failed art with a fallback waits for the fallback", async () => {
  const { container, unmount } = await render(landscape("https://media.example.com/gate-3.jpg", undefined, ["https://media.example.com/gate-3b.jpg"]));
  const frame = container.querySelector(".card-frame")!;
  await fire(container.querySelector(".card-img"), "error");
  expect(frame.getAttribute("data-art")).toBe("pending");
  expect(container.querySelector(".card-img")!.getAttribute("src")).toBe("https://media.example.com/gate-3b.jpg");
  await fire(container.querySelector(".card-img"), "load");
  expect(frame.getAttribute("data-art")).toBe("ready");
  await unmount();
});

test("a card drawn again shows art and logo at once, without the fade", async () => {
  markImageLoaded("https://media.example.com/gate-4.jpg");
  markImageLoaded("https://media.example.com/gate-4-logo.png");
  const { container, unmount } = await render(landscape("https://media.example.com/gate-4.jpg", "https://media.example.com/gate-4-logo.png"));
  expect(container.querySelector(".card-frame")!.getAttribute("data-art")).toBe("ready");
  expect(container.querySelector(".card-img")!.getAttribute("data-loaded")).toBe("true");
  expect(container.querySelector(".card-logo")!.getAttribute("data-loaded")).toBe("true");
  await unmount();
});

test("a card without art has nothing to wait for", async () => {
  const { container, unmount } = await render(
    <Card shape="landscape" title="A Placeholder Film" fallback={<span>A Placeholder Film</span>}>
      <ArtTitle name="A Placeholder Film" />
    </Card>,
  );
  expect(container.querySelector(".card-frame")!.getAttribute("data-art")).toBe("ready");
  await unmount();
});

function Hero({ background }: { background?: string }) {
  return (
    <section className="detail-hero" {...useArtGate(background)}>
      <TitleHeading name="A Placeholder Film" look="detail" />
    </section>
  );
}

test("a hero's name waits for its backdrop, which another image on the page loads", async () => {
  const { container, unmount } = await render(<Hero background="https://media.example.com/gate-5.jpg" />);
  const hero = container.querySelector(".detail-hero")!;
  expect(hero.getAttribute("data-art")).toBe("pending");
  expect(container.querySelector("h1")!.classList.contains("art-after")).toBe(true);
  await act(async () => markImageLoaded("https://media.example.com/gate-5.jpg"));
  expect(hero.getAttribute("data-art")).toBe("ready");
  await unmount();
});
