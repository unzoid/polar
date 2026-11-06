import { secretsState, useAccount } from "../../lib/account";
import { openSettings } from "../../lib/settings";
import type { Os } from "../../lib/platform";
import type { SecretsPlace } from "../../lib/types";

const KEYCHAIN: Record<Os, string> = {
  macos: "the macOS Keychain",
  windows: "Windows Credential Manager",
  linux: "your desktop's keyring",
  android: "the system's keystore",
  ios: "the iOS Keychain",
};

/** Settings → Account's "On this device": where the keys and links are, as the native side says. */
export function deviceStoreText(place: SecretsPlace, os: Os): string {
  const phone = os === "android" || os === "ios";
  switch (place) {
    case "keychain":
      return `Your API keys and add-on links are in ${KEYCHAIN[os]}, encrypted by the system and unlocked by your sign-in to this ${phone ? "device" : "computer"}. The rest of Polarity's data is in its data file (polarity.json).`;
    case "unreadable":
      return `Polarity couldn't open ${KEYCHAIN[os]} when it started, so the keys and add-on links kept there aren't loaded; restart Polarity once it's unlocked. Ones you enter meanwhile are kept in Polarity's data file (polarity.json) until then.`;
    case "file":
      return phone
        ? "Your API keys and add-on links are in Polarity's data file, in storage only Polarity can read on this device."
        : `Your API keys and add-on links are in Polarity's data file (polarity.json, in the app's data folder), readable by programs running under your user account: Polarity couldn't use ${KEYCHAIN[os]} on this system.`;
  }
}

/**
 * Where API keys and add-on links are entered and in Settings → Account: how they travel for a
 * signed-in profile (#89). Nothing while signed out or a guest, when they stay on this device.
 */
export function useSecretsNote(): string | undefined {
  const account = useAccount();
  if (account.status !== "ready" || !account.profile) return;
  switch (secretsState(account.profile.id)) {
    case "plain":
      return "Your API keys and add-ons sync to your account. They're protected by your sign-in, but stored readable on the server; set a passphrase in Settings → Account to encrypt them so only your devices can read them.";
    case "sealed":
      return "Your API keys and add-ons sync to your account, encrypted with your passphrase: only your devices can read them.";
    case "locked":
      return "Your account's API keys and add-ons are encrypted with a passphrase this device doesn't have yet. Type it in Settings → Account to use them here; until then, what you enter stays on this device.";
  }
}

/** Set by `showWhereStored`: Settings → Account opens with "API keys and addons" expanded. */
let whereAsked = false;

/** The warnings' "What's stored where": Settings → Account, at the row that says it. */
export function showWhereStored() {
  whereAsked = true;
  openSettings("account");
}

/** Whether Settings → Account was opened to say where things are stored; asked once per opening. */
export function takeWhereStored(): boolean {
  const asked = whereAsked;
  whereAsked = false;
  return asked;
}
