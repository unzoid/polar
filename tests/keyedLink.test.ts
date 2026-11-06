import { describe, expect, test } from "bun:test";
import { linkHasKey } from "../src/lib/account/keyedLink";

const b64 = (s: string) => btoa(s).replace(/=+$/, "");

describe("linkHasKey", () => {
  test("plain manifest links have no key", () => {
    for (const link of [
      "https://addon.example.com/manifest.json",
      "https://addon.example.com/v2/manifest.json",
      "https://example.org/catalog-2024-movies-extended/manifest.json",
      "https://addon.example.com/manifest.json?lang=en",
      "https://example.org/lang=en|region=gb/manifest.json",
      "https://example.org/" + encodeURIComponent(JSON.stringify({ language: "en", showRatings: true })) + "/manifest.json",
      "https://example.org/" + b64(JSON.stringify({ language: "en" })) + "/manifest.json",
      "not a link",
    ]) {
      expect([link, linkHasKey(link)]).toEqual([link, false]);
    }
  });

  test("a key-named parameter is a key", () => {
    expect(linkHasKey("https://addon.example.com/manifest.json?apikey=xxx")).toBe(true);
    expect(linkHasKey("https://addon.example.com/manifest.json?token=TOKEN")).toBe(true);
    expect(linkHasKey("https://addon.example.com/manifest.json?api_key=abc")).toBe(true);
    expect(linkHasKey("https://addon.example.com/manifest.json?key=")).toBe(false);
  });

  test("a long token in the path or a parameter is a key", () => {
    expect(linkHasKey("https://addon.example.com/a8Fk2LmQ9xZ3pR7tY1wB/manifest.json")).toBe(true);
    expect(linkHasKey("https://addon.example.com/3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f/manifest.json")).toBe(true);
    expect(linkHasKey("https://addon.example.com/manifest.json?u=a8Fk2LmQ9xZ3pR7tY1wB")).toBe(true);
  });

  test("a config in the path with a key in it is a key", () => {
    const config = { provider: "example", apiKey: "xxx", language: "en" };
    expect(linkHasKey("https://example.org/" + b64(JSON.stringify(config)) + "/manifest.json")).toBe(true);
    expect(linkHasKey("https://example.org/" + encodeURIComponent(JSON.stringify(config)) + "/manifest.json")).toBe(true);
    expect(linkHasKey("https://example.org/lang=en|serviceToken=xxx/manifest.json")).toBe(true);
    expect(linkHasKey("https://example.org/" + b64(JSON.stringify({ services: [{ id: "x", key: "TOKEN" }] })) + "/manifest.json")).toBe(true);
  });

  test("a user and password in the link is a key", () => {
    expect(linkHasKey("https://user:pass@addon.example.com/manifest.json")).toBe(true);
  });
});
