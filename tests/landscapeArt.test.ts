import { expect, test } from "bun:test";
import { landscapeArt, linkedImdb, posterArt, withLinkedArt } from "../src/lib/anime/landscapeArt";

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

test("the IMDb id a card links to: the one an opened page found, else the id lists', unknown until both answer (#34)", () => {
  const links = [{ canonical: "tt0000002", anilist: 7, updatedAt: 1 }, { canonical: "kitsu:9", anilist: 8, updatedAt: 1 }];
  expect(linkedImdb(7, "tt0000001", links)).toBe("tt0000002");
  expect(linkedImdb(8, "tt0000003", links)).toBe("tt0000003");
  expect(linkedImdb(9, null, links)).toBeNull();
  expect(linkedImdb(9, undefined, links)).toBeUndefined();
  expect(linkedImdb(9, "tt0000001", undefined)).toBeUndefined();
});

test("a TV landscape anime card shows the linked backdrop first, with its own art behind it (#34)", () => {
  const preview = { id: "anilist:7", type: "series", name: "Kiko", poster: cover, background: banner };
  expect(withLinkedArt(preview, "tt0000001")).toEqual({
    item: { ...preview, background: "https://images.metahub.space/background/large/tt0000001/img" },
    fallbacks: [banner, cover],
  });
  expect(withLinkedArt(preview, null)).toEqual({ item: preview, fallbacks: [cover] });
  expect(withLinkedArt(preview, undefined)).toEqual({ item: { ...preview, background: undefined }, fallbacks: [] });
});

test("a poster card shows the linked title's poster, the same for every season of a show, then the entry's cover (#27)", () => {
  const poster = "https://images.metahub.space/poster/medium/tt0000001/img";
  expect(posterArt({ imdb: "tt0000001", cover })).toEqual([poster, cover]);
  expect(posterArt({ imdb: "kitsu:9", cover })).toEqual([cover]);
  expect(posterArt({ imdb: null, cover: null })).toEqual([]);
  const preview = { id: "anilist:7", type: "series", name: "Kiko", poster: cover, background: banner };
  expect(withLinkedArt(preview, "tt0000001", "poster")).toEqual({ item: { ...preview, poster }, fallbacks: [cover] });
  expect(withLinkedArt(preview, undefined, "poster")).toEqual({ item: { ...preview, poster: undefined }, fallbacks: [] });
});
