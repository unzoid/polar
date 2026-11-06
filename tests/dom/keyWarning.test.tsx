import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddonsPage } from "../../src/screens/settings/AddonsPage";
import { AccountContext, forgetSettings, type Account } from "../../src/lib/account";
import { api } from "../../src/lib/api";
import { keys } from "../../src/lib/net";
import type { InstalledAddon } from "../../src/lib/types";
import { byText, click, render } from "./render";

// #195: a key or keyed add-on link is about to sync readable; the user is asked before it's saved.
const signedIn = { status: "ready", profile: { id: "p1", name: "Ada" }, profiles: [], enabled: true } as unknown as Account;
const keyed = "https://addon.example.com/a8Fk2LmQ9xZ3pR7tY1wB/manifest.json";
const plainLink = "https://addon.example.com/manifest.json";
const real = api.installAddon;
let installed: string[] = [];

afterEach(() => {
  api.installAddon = real;
  forgetSettings("p1");
  localStorage.clear();
});

async function page(account: Account) {
  installed = [];
  api.installAddon = async (url: string) => {
    installed.push(url);
    return { manifestUrl: url, manifest: { id: url, name: "Example", version: "1.0.0", resources: [], types: [] } } as unknown as InstalledAddon;
  };
  const qc = new QueryClient();
  qc.setQueryData(keys.addons, []);
  return render(
    <QueryClientProvider client={qc}>
      <AccountContext.Provider value={account}>
        <AddonsPage />
      </AccountContext.Provider>
    </QueryClientProvider>,
  );
}

async function submit(container: HTMLElement, url: string) {
  const input = container.querySelector<HTMLInputElement>('input[placeholder="https://…/manifest.json"]')!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, url);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => void input.form!.requestSubmit());
}

test("a keyed add-on link waits for Save Anyway while keys sync unencrypted", async () => {
  const { container, unmount } = await page(signedIn);
  await submit(container, keyed);
  const warning = container.querySelector(".settings-key-warning");
  expect(warning?.textContent).toContain("This add-on link contains a key. It will be stored on your account unencrypted.");
  expect(warning?.textContent).toContain("Anyone with access to the account server could read it.");
  expect(installed).toEqual([]);
  await click(byText(container, "button", "Save Anyway"));
  expect(installed).toEqual([keyed]);
  expect(container.querySelector(".settings-key-warning")).toBeNull();
  await unmount();
});

test("Set a Passphrase seals first, then saves", async () => {
  const { container, unmount } = await page(signedIn);
  await submit(container, keyed);
  await click(byText(container, "button", "Set a Passphrase"));
  const field = container.querySelector<HTMLInputElement>('input[aria-label="Passphrase"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "correct horse");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(byText(container, "button", "Set and Save"));
  expect(installed).toEqual([keyed]);
  expect(JSON.parse(localStorage.getItem("polar.sync.p1")!).lock).toMatchObject({ passphrase: "correct horse", pending: "set" });
  await unmount();
});

test("Cancel saves nothing", async () => {
  const { container, unmount } = await page(signedIn);
  await submit(container, keyed);
  await click(byText(container, "button", "Cancel"));
  expect(installed).toEqual([]);
  expect(container.querySelector(".settings-key-warning")).toBeNull();
  await unmount();
});

test("no warning for a link without a key, with a passphrase, or as a guest", async () => {
  let { container, unmount } = await page(signedIn);
  await submit(container, plainLink);
  expect(installed).toEqual([plainLink]);
  await unmount();

  localStorage.setItem("polar.secretsPassphrase.p1", JSON.stringify({ passphrase: "correct horse" }));
  ({ container, unmount } = await page(signedIn));
  await submit(container, keyed);
  expect(installed).toEqual([keyed]);
  await unmount();
  localStorage.clear();

  ({ container, unmount } = await page({ ...signedIn, status: "guest", profile: null }));
  await submit(container, keyed);
  expect(installed).toEqual([keyed]);
  expect(container.querySelector(".settings-key-warning")).toBeNull();
  await unmount();
});
