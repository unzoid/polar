import { describe, expect, test } from "bun:test";
import { fromLinkRow, toLinkRow } from "../src/lib/account/supabase";
import type { AnimeLink } from "../src/lib/library/identity";

describe("anime link rows", () => {
  test("round trip keeps every field and leaves absent ids out", () => {
    const full: AnimeLink = { canonical: "tt0000102", anilist: 21, mal: 21, kitsu: 12, updatedAt: 1_762_000_000_000 };
    const bare: AnimeLink = { canonical: "kitsu:7", anilist: 9, updatedAt: 5 };
    for (const link of [full, bare]) {
      const { profile_id, ...row } = toLinkRow("p1", link);
      expect(profile_id).toBe("p1");
      expect(fromLinkRow({ ...row, synced_at: "2026-11-04T00:00:00Z" })).toEqual(link);
    }
    expect(toLinkRow("p1", bare)).toMatchObject({ mal: null, kitsu: null });
  });

  test("bigint times that come back as strings are numbers again", () => {
    const row = { anilist: 1, canonical: "tt1", mal: null, kitsu: null, updated_at: "42" as unknown as number, synced_at: "" };
    expect(fromLinkRow(row)?.updatedAt).toBe(42);
  });
});
