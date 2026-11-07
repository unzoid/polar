import "./storageStub";
import { describe, expect, test } from "bun:test";
import { simklPreviewText, simklSummaryText } from "../src/components/settings/SimklImport";
import { planSimklImport, readSimklImport } from "../src/lib/simkl/simklImport";

// #86: importing a linked Simkl account's Plan to Watch and everything watched into the library.
const T1 = "2026-03-02T00:00:00Z";
const T2 = "2026-03-03T00:00:00Z";

const answers: Record<string, unknown> = {
  shows: {
    shows: [
      {
        status: "watching",
        show: { title: "Harbour Lights", ids: { simkl: 7, imdb: "tt0000002" } },
        seasons: [{ number: 1, episodes: [{ number: 1, watched_at: T1 }, { number: 2 }] }],
      },
      { status: "plantowatch", added_to_watchlist_at: T2, show: { title: "The Lantern Keepers", ids: { simkl: 8, imdb: "tt0000003" } } },
      { status: "plantowatch", show: { title: "Unknown", ids: { simkl: 9 } } },
    ],
  },
  movies: {
    movies: [
      { status: "completed", last_watched_at: T2, movie: { title: "Night Train", ids: { simkl: 1, imdb: "tt0000001" } } },
      { status: "plantowatch", movie: { title: "Morning Ferry", ids: { simkl: 2, imdb: "tt0000004" } } },
    ],
  },
  anime: {
    anime: [
      { status: "completed", show: { title: "Paper Kites", ids: { simkl: 3, kitsu: 5 } }, seasons: [{ number: 1, episodes: [{ number: 3, watched_at: T1 }] }] },
    ],
  },
};

describe("importing a Simkl account", () => {
  test("reads each kind whole once; Plan to Watch becomes the library, finished films and watched episodes the progress", async () => {
    const got: string[] = [];
    const p = await readSimklImport("TOKEN", {
      get: async (path, query, caller) => {
        got.push(`${path}?${new URLSearchParams(query)}`);
        expect(caller.token).toBe("TOKEN");
        return answers[path.split("/").pop() ?? ""];
      },
    });
    expect(got).toEqual([
      "/sync/all-items/shows?extended=full&episode_watched_at=yes",
      "/sync/all-items/movies?extended=full&episode_watched_at=yes",
      "/sync/all-items/anime?extended=full&episode_watched_at=yes",
    ]);
    expect(p.library).toEqual([
      { id: "tt0000003", type: "series", name: "The Lantern Keepers", addedAt: Date.parse(T2) },
      { id: "tt0000004", type: "movie", name: "Morning Ferry", addedAt: 0 },
    ]);
    expect(p.progress.map((r) => r.videoId)).toEqual(["tt0000002:1:1", "tt0000001", "kitsu:5:3"]);
    expect([p.listed, p.watchedFilms, p.watchedEpisodes, p.unlinked]).toEqual([2, 1, 2, 1]);
    expect(planSimklImport(p, { library: false, watched: true })).toEqual({ library: [], progress: p.progress });
    expect(planSimklImport(p, { library: true, watched: false })).toEqual({ library: p.library, progress: [] });
  });

  test("an empty account, and what the screen says", async () => {
    const p = await readSimklImport("TOKEN", { get: async () => null });
    expect([p.library, p.progress, p.unlinked]).toEqual([[], [], 0]);
    expect(simklPreviewText(p)).toBe("Nothing on Plan to Watch. Nothing watched yet.");
    expect(simklPreviewText({ listed: 1, watchedFilms: 2, watchedEpisodes: 1, unlinked: 3 })).toBe(
      "1 title on Plan to Watch. 2 films and 1 episode watched. 3 titles without an IMDb page or a Kitsu entry left out.",
    );
    expect(simklSummaryText({ library: 1, progress: 1 })).toBe("Added 1 title to your library and 1 watched film or episode.");
  });
});
