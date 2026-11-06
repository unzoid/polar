import "./storageStub";
import { expect, test } from "bun:test";
import { dismissNotice, exposedNames, forgetNotices, noteFirstPlainSync, noticeDue, onFirstPlainSync, secretsExposed } from "../src/lib/account/secretsNotice";

const keyed = { id: "org.example.keyed", url: "https://addon.example.com/manifest.json?apikey=xxx" };
const plain = { id: "org.example.plain", url: "https://addon.example.com/manifest.json" };

test("only keys that are set and add-ons whose link holds a key are exposed, by name", () => {
  const names = exposedNames({ tmdbKey: "TOKEN", omdbKey: null, seekrKey: "" }, [keyed, plain]);
  expect(names).toEqual(["addon:org.example.keyed", "key:tmdbKey"]);
  expect(names.join()).not.toContain("TOKEN");
  expect(secretsExposed({ keys: {}, addons: [plain.url] })).toBe(false);
  expect(secretsExposed({ keys: {}, addons: [keyed.url] })).toBe(true);
  expect(secretsExposed({ keys: { tmdbKey: "TOKEN" }, addons: [] })).toBe(true);
});

test("Settings → Account's notice stays dismissed until a new key or keyed link comes", () => {
  forgetNotices("p1");
  const before = ["key:tmdbKey"];
  expect(noticeDue("p1", before)).toBe(true);
  dismissNotice("p1", before);
  expect(noticeDue("p1", before)).toBe(false);
  expect(noticeDue("p1", [])).toBe(false);
  expect(noticeDue("p1", ["addon:org.example.keyed", "key:tmdbKey"])).toBe(true);
  expect(noticeDue("p2", before)).toBe(true);
});

test("the first plain sync is said once per profile on this device", () => {
  forgetNotices("p1");
  const heard: string[] = [];
  const stop = onFirstPlainSync((s) => heard.push(s));
  noteFirstPlainSync("p1");
  noteFirstPlainSync("p1");
  forgetNotices("p1");
  noteFirstPlainSync("p1");
  stop();
  noteFirstPlainSync("p3");
  expect(heard).toEqual(["p1", "p1"]);
});
