import { expect, test } from "bun:test";
import { landscapeArt } from "../src/lib/anime/landscapeArt";

const cover = "https://art.example/cover.jpg";
const banner = "https://art.example/banner.jpg";

test("a landscape card tries the linked IMDb title's backdrop first, then the banner, then the cover (re-test N5)", () => {
  expect(landscapeArt({ imdb: "tt0000001", bannerImage: banner, cover })).toEqual([
    "https://images.metahub.space/background/large/tt0000001/img",
    banner,
    cover,
  ]);
});

test("without an IMDb link: the banner, then the cover", () => {
  expect(landscapeArt({ imdb: null, bannerImage: banner, cover })).toEqual([banner, cover]);
  expect(landscapeArt({ imdb: "kitsu:1", bannerImage: null, cover })).toEqual([cover]);
});
