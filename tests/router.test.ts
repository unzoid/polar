import { expect, test } from "bun:test";
import { pushed, type Entry, type Route } from "../src/lib/router";

const stack = (...routes: Route[]): Entry[] => routes.map((route, key) => ({ key, route }));
const names = (s: Entry[]) => s.map((e) => (e.route.name === "detail" ? `detail ${e.route.id}` : e.route.name));
let k = 100;
const key = () => k++;

test("the player always steps back to its title's page, whatever opened it (test report 1, item 5)", () => {
  const play: Route = { name: "player", type: "series", metaId: "tt9", videoId: "tt9:1:2" };
  // From Continue Watching on Home: the title page goes under the player.
  expect(names(pushed(stack({ name: "home" }), play, key))).toEqual(["home", "detail tt9", "player"]);
  // From the title page itself: nothing added.
  expect(names(pushed(stack({ name: "home" }, { name: "detail", type: "series", id: "tt9" }), play, key))).toEqual(["home", "detail tt9", "player"]);
  // From an anime's page (its own id is AniList's): nothing added.
  expect(names(pushed(stack({ name: "anime" }, { name: "anime-detail", id: 5 }), play, key))).toEqual(["anime", "anime-detail", "player"]);
  // Another title's page (a "because you watched" card's menu): this title's page goes in between.
  expect(names(pushed(stack({ name: "home" }, { name: "detail", type: "series", id: "tt1" }), play, key))).toEqual([
    "home",
    "detail tt1",
    "detail tt9",
    "player",
  ]);
  // Other pages are pushed as they are.
  expect(names(pushed(stack({ name: "home" }), { name: "search" }, key))).toEqual(["home", "search"]);
});
