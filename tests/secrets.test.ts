import { describe, expect, test } from "bun:test";
import { open, seal, type Secrets } from "../src/lib/account/secrets";

// Few rounds keep the tests fast; the format is the same.
const R = 1_000;
const secrets: Secrets = { keys: { tmdbKey: "0123456789abcdef0123456789abcdef", omdbKey: "abcd1234" }, addons: ["https://a.example/manifest.json"] };

describe("sealed keys and add-on links", () => {
  test("the right passphrase opens what was sealed", async () => {
    const text = await seal("correct horse", secrets, R);
    expect(text.startsWith("s1.")).toBe(true);
    expect(await open("correct horse", text, R)).toEqual(secrets);
  });

  test("nothing readable is in the sealed text, and each seal differs", async () => {
    const [a, b] = await Promise.all([seal("pw", secrets, R), seal("pw", secrets, R)]);
    expect(a).not.toBe(b);
    for (const plain of ["0123456789abcdef", "abcd1234", "a.example", "tmdbKey"]) expect(atob(a.split(".")[3]).includes(plain)).toBe(false);
  });

  test("a wrong passphrase, damaged text or another format opens to null", async () => {
    const text = await seal("pw", secrets, R);
    expect(await open("pW", text, R)).toBeNull();
    const parts = text.split(".");
    const flipped = atob(parts[3]);
    const damaged = [...parts.slice(0, 3), btoa(String.fromCharCode(flipped.charCodeAt(0) ^ 1) + flipped.slice(1))].join(".");
    expect(await open("pw", damaged, R)).toBeNull();
    expect(await open("pw", "s2" + text.slice(2), R)).toBeNull();
    expect(await open("pw", "s1.x.y", R)).toBeNull();
    expect(await open("pw", "s1.!!.!!.!!", R)).toBeNull();
  });

  test("the passphrase is compared in one Unicode form", async () => {
    const text = await seal("café", secrets, R);
    expect(await open("café", text, R)).toEqual(secrets);
  });
});
