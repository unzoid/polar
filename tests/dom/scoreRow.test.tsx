import { afterEach, expect, spyOn, test } from "bun:test";
import { ScoreRow } from "../../src/components/title/TitleDetails";
import { api } from "../../src/lib/api";
import { click, render } from "./render";

// The title page's row of scores from the user's MDBList/OMDb key.
afterEach(() => (document.body.innerHTML = ""));

test("shows each known score in order, with the right tone", async () => {
  const { container } = await render(
    <ScoreRow ratings={{ imdb: 8.2, tmdb: 86, trakt: 87, letterboxd: 4.3, rottenTomatoes: 95, audience: 40, metacritic: 74 }} />,
  );
  const items = [...container.querySelectorAll<HTMLElement>(".score-row-item")];
  expect(items.map((i) => [i.dataset.site, i.textContent])).toEqual([
    ["imdb", "8.2"],
    ["tmdb", "86"],
    ["trakt", "87"],
    ["letterboxd", "4.3"],
    ["rottenTomatoes", "95%"],
    ["audience", "40%"],
    ["metacritic", "74"],
  ]);
  expect(items.map((i) => i.dataset.tone ?? "")).toEqual(["", "", "", "", "fresh", "rotten", "good"]);
});

test("a score with a known page opens it; one without isn't a button", async () => {
  const opened: string[] = [];
  const external = spyOn(api, "openExternal").mockImplementation(async (url) => void opened.push(url));
  const { container } = await render(
    <ScoreRow ratings={{ imdb: 7.1, trakt: 70, links: { imdb: "https://www.imdb.com/title/tt0000000/" } }} />,
  );
  const buttons = container.querySelectorAll("button");
  expect(buttons.length).toBe(1);
  await click(buttons[0]);
  expect(opened).toEqual(["https://www.imdb.com/title/tt0000000/"]);
  external.mockRestore();
});

test("nothing without scores", async () => {
  const { container } = await render(<ScoreRow ratings={{ awards: "Won 1 award", rated: "PG" }} />);
  expect(container.innerHTML).toBe("");
});
