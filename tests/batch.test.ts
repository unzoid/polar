import { expect, test } from "bun:test";
import { batcher } from "../src/lib/net/batch";

test("asks close together go as one request, each with its own answer (test report 1, item 21)", async () => {
  const requests: string[][] = [];
  const load = batcher(async (genres: string[]) => {
    requests.push(genres);
    return genres.map((g) => g.toUpperCase());
  }, { wait: 10, max: 3 });
  const answers = await Promise.all(["action", "comedy", "drama", "horror"].map(load));
  expect(answers).toEqual(["ACTION", "COMEDY", "DRAMA", "HORROR"]);
  expect(requests).toEqual([["action", "comedy", "drama"], ["horror"]]);
  // Later asks make a request of their own.
  expect(await load("mystery")).toBe("MYSTERY");
  expect(requests.length).toBe(3);
});

test("a failed request fails each ask in it", async () => {
  const load = batcher(async () => {
    throw new Error("429");
  }, { wait: 1 });
  const all = await Promise.allSettled([load(1), load(2)]);
  expect(all.map((r) => r.status)).toEqual(["rejected", "rejected"]);
});
