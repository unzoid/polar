import { secretsState, useAccount } from "../../lib/account";
import { openSettings } from "../../lib/settings";

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
