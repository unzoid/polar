import { expect, test } from "bun:test";
import { Window } from "happy-dom";

// The button itself (#208), in a stand-in page at each site's address: built as the browser gets it
// and run with that page's window, document and location. The real sites are left to a person
// (extension/README.md says how).

const built = await Bun.build({ entrypoints: [`${import.meta.dir}/../src/content.ts`], format: "iife", target: "browser" });
const code = await built.outputs[0].text();

function visit(url: string, head = "", body = "") {
  const win = new Window({ url });
  win.document.write(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`);
  let tick = () => {};
  const run = new Function("window", "document", "location", "setInterval", "HTMLAnchorElement", "HTMLVideoElement", code);
  run(win, win.document, win.location, (fn: () => void) => ((tick = fn), 0), win.HTMLAnchorElement, win.HTMLVideoElement);
  const bar = () => win.document.querySelector("polarity-open")?.shadowRoot ?? null;
  return {
    win,
    tick: () => tick(),
    link: () => bar()?.querySelector("a") ?? null,
    hide: () => bar()!.querySelector("button")!.click(),
  };
}

const MOVIE = '<meta property="og:type" content="video.movie">';

test("a title page shows Open in Polarity, linking to the website's /watch page", () => {
  const { link } = visit("https://www.imdb.com/title/tt0000001/", MOVIE);
  expect(link()!.textContent).toBe("Open in Polarity");
  expect(link()!.getAttribute("href")).toBe("https://getpolar.app/watch/?type=movie&id=tt0000001");
  expect(link()!.getAttribute("target")).toBe("_blank");
  expect(visit("https://anilist.co/anime/21/Some-Show").link()!.getAttribute("href")).toBe("https://getpolar.app/watch/?type=anime&id=anilist%3A21");
  expect(visit("https://www.themoviedb.org/tv/77-a-show").link()!.getAttribute("href")).toBe("https://getpolar.app/watch/?type=series&id=tmdb%3A77");
});

test("an episode, a list or a search page shows nothing", () => {
  expect(visit("https://www.imdb.com/title/tt0000001/", '<meta property="og:type" content="video.episode">').link()).toBeNull();
  expect(visit("https://www.imdb.com/chart/top/", MOVIE).link()).toBeNull();
  expect(visit("https://anilist.co/search/anime").link()).toBeNull();
  expect(visit("https://www.youtube.com/results?search_query=x").link()).toBeNull();
});

test("Letterboxd's film page: the title comes from its links to IMDb and TMDB, once they're there", () => {
  const page = visit("https://letterboxd.com/film/an-open-film/");
  expect(page.link()).toBeNull();
  page.win.document.body.innerHTML = '<a href="https://www.imdb.com/title/tt0000003/maindetails">IMDb</a><a href="https://www.themoviedb.org/movie/42/">TMDB</a>';
  page.tick();
  // IMDb's link has a sub-page here: TMDB's is used.
  expect(page.link()!.getAttribute("href")).toBe("https://getpolar.app/watch/?type=movie&id=tmdb%3A42");
});

test("a YouTube video offers Watch together, from where it's playing, and follows the page without a reload", () => {
  const page = visit("https://www.youtube.com/watch?v=abc-DEF_123", "<title>An open film - YouTube</title>", '<video class="html5-main-video"></video>');
  const video = page.win.document.querySelector("video")!;
  Object.defineProperty(video, "currentTime", { value: 42.6, configurable: true });
  const link = page.link()!;
  expect(link.textContent).toBe("Watch together in Polarity");
  link.dispatchEvent(new page.win.Event("pointerdown"));
  const u = new URL(link.getAttribute("href")!);
  expect(u.origin + u.pathname + u.search).toBe("https://getpolar.app/party/");
  expect(Object.fromEntries(new URLSearchParams(u.hash.slice(1)))).toEqual({ u: "https://www.youtube.com/watch?v=abc-DEF_123", t: "42", n: "An open film" });

  page.win.history.pushState({}, "", "/feed/subscriptions");
  page.tick();
  expect(page.link()).toBeNull();
  page.win.history.pushState({}, "", "/shorts/zyx-WVU_987");
  page.tick();
  expect(new URLSearchParams(new URL(page.link()!.getAttribute("href")!).hash.slice(1)).get("u")).toBe("https://www.youtube.com/watch?v=zyx-WVU_987");
});

test("Hide takes the button away on this page only", () => {
  const page = visit("https://www.youtube.com/watch?v=abc-DEF_123");
  page.hide();
  expect(page.link()).toBeNull();
  page.tick();
  expect(page.link()).toBeNull();
  page.win.history.pushState({}, "", "/watch?v=zyx-WVU_987");
  page.tick();
  expect(page.link()).not.toBeNull();
});
