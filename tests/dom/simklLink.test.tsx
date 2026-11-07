import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SimklSignIn } from "../../src/components/settings/SimklSignIn";
import { ServicesPage } from "../../src/screens/settings/ServicesPage";
import { AccountContext, type Account } from "../../src/lib/account";
import { keys } from "../../src/lib/net";
import type { KeyStorage } from "../../src/lib/platform/keychain";
import { setSimklLinkStorage, simklLinkName, type SimklLink } from "../../src/lib/simkl/link";
import { byText, click, render } from "./render";

// #86: the profile's Simkl link in Settings, signed in with a device code.
const link: SimklLink = { token: "TOKEN", refreshToken: "REFRESH", expiresAt: Date.now() + 6 * 86_400_000, account: 42, name: "Someone" };
const realFetch = globalThis.fetch;
let keychain: Map<string, string>;
let asked: { path: string; body: Record<string, string> | undefined; auth?: string }[] = [];
let tokenAnswer: () => Response;

function memoryKeychain(): KeyStorage {
  return {
    getItem: async (k) => keychain.get(k) ?? null,
    setItem: async (k, v) => void keychain.set(k, v),
    removeItem: async (k) => void keychain.delete(k),
    peek: (k) => keychain.get(k),
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  keychain = new Map();
  setSimklLinkStorage(memoryKeychain());
  asked = [];
  tokenAnswer = () => json({ access_token: "NEW", refresh_token: "NEWR", expires_in: 604800, scope: "media:read media:write" });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname;
    const headers = (init.headers ?? {}) as Record<string, string>;
    asked.push({ path, body: init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : undefined, auth: headers.Authorization });
    if (u.origin !== "https://api.simkl.com") return new Response(null, { status: 404 });
    if (path === "/oauth2/device")
      return json({
        device_code: "DEVICE",
        user_code: "BDWP-HQPK",
        verification_uri: "https://simkl.com/pin",
        verification_uri_complete: "https://simkl.com/pin?user_code=BDWP-HQPK",
        expires_in: 900,
        interval: 5,
      });
    if (path === "/oauth2/token") return tokenAnswer();
    if (path === "/users/settings") return json({ user: { name: "Someone" }, account: { id: 42 } });
    if (path === "/oauth2/revoke") return json({});
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setSimklLinkStorage(undefined);
  localStorage.clear();
});

const wrap = (node: React.ReactNode) => {
  const qc = new QueryClient();
  qc.setQueryData(keys.settings, {});
  const signedOut = { status: "signed-out", profile: null, profiles: [], enabled: false } as unknown as Account;
  return render(
    <QueryClientProvider client={qc}>
      <AccountContext.Provider value={signedOut}>{node}</AccountContext.Provider>
    </QueryClientProvider>,
  );
};

async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
}

test("Settings: without a client id the row says so and asks Simkl nothing", async () => {
  const view = await wrap(<ServicesPage />);
  await settle();
  await click(byText(view.container, ".settings-row-title, .settings-row-button *", "Simkl").closest("button"));
  expect(view.container.textContent).toContain("signing in to Simkl needs Polarity registered with Simkl first");
  expect(asked).toEqual([]);
  await view.unmount();
});

test("Settings: a linked profile sees its account and unlinks, which revokes the sign-in", async () => {
  keychain.set(simklLinkName(null), JSON.stringify(link));
  const view = await wrap(<ServicesPage />);
  await settle();
  await click(byText(view.container, ".settings-row-title, .settings-row-button *", "Simkl").closest("button"));
  expect(view.container.textContent).toContain("Linked as Someone");
  await click(byText(view.container, "button", "Unlink"));
  await settle();
  expect(keychain.has(simklLinkName(null))).toBe(false);
  expect(asked.at(-1)).toMatchObject({ path: "/oauth2/revoke", body: { token: "REFRESH" } });
  await view.unmount();
});

test("the sign-in shows the code, waits for Simkl and links the profile", async () => {
  const view = await wrap(<SimklSignIn space={null} />);
  await click(byText(view.container, "button", "Get a code"));
  await settle();
  expect(view.container.querySelector(".device-code")?.textContent).toBe("BDWP-HQPK");
  expect(view.container.textContent).toContain("simkl.com/pin");
  expect(view.container.textContent).toContain("Waiting for you to allow Polarity on Simkl");
  expect(asked[0].body).toMatchObject({ scope: "media:read media:write" });
  // Simkl's polls are 5 s apart.
  for (let i = 0; i < 100 && !keychain.has(simklLinkName(null)); i++) await settle(10);
  expect(JSON.parse(keychain.get(simklLinkName(null))!)).toMatchObject({ token: "NEW", refreshToken: "NEWR", account: 42, name: "Someone" });
  expect(asked.find((a) => a.path === "/users/settings")?.auth).toBe("Bearer NEW");
  await view.unmount();
}, 20_000);

test("a sign-in allowed read-only isn't kept: it says why and offers a new code", async () => {
  tokenAnswer = () => json({ access_token: "NEW", refresh_token: "NEWR", expires_in: 604800, scope: "media:read" });
  const view = await wrap(<SimklSignIn space={null} />);
  await click(byText(view.container, "button", "Get a code"));
  for (let i = 0; i < 100 && !view.container.querySelector('[role="alert"]'); i++) await settle(10);
  expect(view.container.textContent).toContain("Simkl only allowed reading your lists");
  expect(keychain.has(simklLinkName(null))).toBe(false);
  expect(asked.at(-1)).toMatchObject({ path: "/oauth2/revoke", body: { token: "NEWR" } });
  expect(byText(view.container, "button", "Get a new code")).toBeTruthy();
  await view.unmount();
}, 20_000);
