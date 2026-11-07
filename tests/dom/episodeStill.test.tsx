import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EpisodeCard } from "../../src/components/title/EpisodeCard";
import type { Video } from "../../src/lib/types";
import { render } from "./render";

// An invented web short's episode: no still from any source.
const video = { id: "kitsu:0:1", title: "The First Lantern", season: 1, episode: 1, released: "2020-01-01T00:00:00Z" } as Video;
const banner = "https://media.example.com/banner.jpg";

const card = (stillFallback?: string, v: Video = video) => (
  <QueryClientProvider client={new QueryClient()}>
    <EpisodeCard layout="row" video={v} upNext={false} onPlay={() => {}} onSources={() => {}} stillFallback={stillFallback} />
  </QueryClientProvider>
);

test("an episode with no still shows the show's banner, dimmed, instead of an empty card (#192)", async () => {
  const { container, unmount } = await render(card(banner));
  const fallback = container.querySelector(".episode-still-fallback img");
  expect(fallback?.getAttribute("src")).toBe(banner);
  expect(container.querySelector(".still-placeholder")).toBeNull();
  await unmount();
});

test("an episode's own still still comes first, and without a banner the placeholder stays (#192)", async () => {
  const own = await render(card(banner, { ...video, thumbnail: "https://media.example.com/still.jpg" }));
  expect([...own.container.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual(["https://media.example.com/still.jpg"]);
  await own.unmount();
  const none = await render(card(undefined));
  expect(none.container.querySelector(".still-placeholder")).not.toBeNull();
  await none.unmount();
});
