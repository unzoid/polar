import "./storageStub";
import { expect, test } from "bun:test";
import { deviceStoreText } from "../src/components/settings/secretsNote";

test("keys in the keychain name the system's own and say the data file holds the rest", () => {
  expect(deviceStoreText("keychain", "macos")).toContain("the macOS Keychain");
  expect(deviceStoreText("keychain", "windows")).toContain("Windows Credential Manager");
  expect(deviceStoreText("keychain", "linux")).toContain("keyring");
  expect(deviceStoreText("keychain", "linux")).not.toContain("readable by programs");
});

test("keys in the data file say who can read them, on a computer and on a phone", () => {
  expect(deviceStoreText("file", "linux")).toContain("readable by programs running under your user account");
  expect(deviceStoreText("file", "android")).toContain("only Polarity can read");
  expect(deviceStoreText("file", "ios")).not.toContain("polarity.json");
});

test("a keychain that couldn't be read says the keys there aren't loaded", () => {
  expect(deviceStoreText("unreadable", "macos")).toContain("aren't loaded");
});
