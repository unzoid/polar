import { expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { autoPickOrder, useSourceFilters, type SourceFilters } from "../../src/lib/playback/sources";
import type { RankedStream } from "../../src/lib/types";
import { render } from "./render";

// #225: a file the backend found to be another episode's (RankedStream.otherEpisode).
const source = (name: string, other = false, resolution = 1080): RankedStream => ({
  stream: { url: `https://media.example.com/${name}.mkv` },
  addon: "Addon",
  quality: { resolution, hdr: false, dolbyVision: false, lowQualitySource: false, direct: true, languages: [], tags: [] },
  label: name,
  requestId: other ? "kitsu:12:5" : "tt0000001:1:5",
  fileEpisode: other ? "Episode 6" : "S01E05",
  otherEpisode: other,
});

// Other episodes' files in 4K: they would score best on the picture alone.
const streams = [source("next-episode", true, 2160), source("right"), source("right-720", false, 720), source("previous-episode", true, 2160)];

test("#225: autoplay never picks another episode's file, however well it scores", () => {
  expect(autoPickOrder(streams).map((r) => r.label)).toEqual(["right", "right-720"]);
  // Nothing but other episodes: nothing to try by itself.
  expect(autoPickOrder(streams.filter((r) => r.otherEpisode))).toEqual([]);
});

test("#225: source lists put other episodes' files last, after sources the filters leave out", async () => {
  let f!: SourceFilters;
  const Probe = () => {
    f = useSourceFilters(streams, undefined);
    return null;
  };
  // Best Match asks which player this device has (mpv or the built-in one).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = await render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  expect(f.view.map(({ r }) => r.label)).toEqual(["right", "right-720", "next-episode", "previous-episode"]);
  expect([f.matched, f.otherEpisodes]).toEqual([2, 2]);

  // A filter that leaves out the 720p file: it follows the matches, other episodes still after it.
  await act(async () => f.set({ res: "1080" }));
  expect(f.view.map(({ r }) => r.label)).toEqual(["right", "right-720", "next-episode", "previous-episode"]);
  expect([f.matched, f.otherEpisodes]).toEqual([1, 2]);
  await unmount();
});
