import { expect, test } from "bun:test";
import { confirmAddon, dismissAddonOffer, getAddonOffer, offerAddon, type OfferDeps } from "../src/lib/deepLink/addonOffer";
import { STREMIO_NOTES, isLocalHost, openStremioLink, parseStremioLink, type StremioOpen } from "../src/lib/deepLink/stremio";

// stremio:// links opened in Polarity (#163).

test("an install link stands for the same https:// manifest address", () => {
  expect(parseStremioLink("stremio://addon.example.com/manifest.json")).toEqual({ kind: "addon", manifestUrl: "https://addon.example.com/manifest.json" });
  expect(parseStremioLink("stremio://addon.example.com/c0nf1g%3D/manifest.json")).toEqual({
    kind: "addon",
    manifestUrl: "https://addon.example.com/c0nf1g%3D/manifest.json",
  });
  expect(parseStremioLink("  stremio://addon.example.com:8443/a/manifest.json?lang=en ")).toEqual({
    kind: "addon",
    manifestUrl: "https://addon.example.com:8443/a/manifest.json?lang=en",
  });
  for (const bad of [
    "stremio://addon.example.com/",
    "stremio://addon.example.com/manifest.json.exe",
    "stremio://user:TOKEN@addon.example.com/manifest.json",
    "stremio://addon.example.com/manifest.json#x",
    "stremio:///manifest.json",
    "stremio://",
  ]) {
    expect(parseStremioLink(bad)).toEqual({ kind: "unknown" });
  }
});

test("an install link for this device or the local network isn't offered", () => {
  for (const host of ["localhost:7000", "127.0.0.1:7000", "192.168.1.20", "10.0.0.5", "172.20.1.1", "[::1]:7000", "[fd00::1]", "nas.local", "addon", "169.254.1.1"]) {
    expect(parseStremioLink(`stremio://${host}/manifest.json`)).toEqual({ kind: "unknown", local: true });
  }
  // The same, written another way: a trailing dot, an IPv4 address inside an IPv6 one, short IPv4 forms.
  for (const host of ["localhost.", "nas.local.", "addon.", "[::127.0.0.1]", "[::ffff:192.168.1.20]", "[64:ff9b::a00:5]", "127.1", "0x7f.1", "0"]) {
    expect(parseStremioLink(`stremio://${host}/manifest.json`)).toEqual({ kind: "unknown", local: true });
  }
  expect(isLocalHost("addon.example.com")).toBe(false);
  expect(isLocalHost("addon.example.com.")).toBe(false);
  expect(isLocalHost("2001:db8::1")).toBe(false);
  expect(isLocalHost("172.32.0.1")).toBe(false);
  expect(isLocalHost("203.0.113.9")).toBe(false);
});

test("a title link opens the title, with a video id the episode", () => {
  expect(parseStremioLink("stremio:///detail/movie/tt0000000")).toEqual({ kind: "title", type: "movie", id: "tt0000000" });
  expect(parseStremioLink("stremio://detail/series/tt0000000")).toEqual({ kind: "title", type: "series", id: "tt0000000" });
  expect(parseStremioLink("stremio:///detail/series/tt0000000/tt0000000%3A1%3A2")).toEqual({
    kind: "title",
    type: "series",
    id: "tt0000000",
    videoId: "tt0000000:1:2",
  });
  expect(parseStremioLink("stremio:///detail/series/kitsu:42/kitsu:42:3")).toEqual({ kind: "title", type: "series", id: "kitsu:42", videoId: "kitsu:42:3" });
  // A movie's video id is the movie; another show's episode is left out.
  expect(parseStremioLink("stremio:///detail/movie/tt0000000/tt0000000")).toEqual({ kind: "title", type: "movie", id: "tt0000000" });
  expect(parseStremioLink("stremio:///detail/series/tt0000000/tt0000001:1:2")).toEqual({ kind: "title", type: "series", id: "tt0000000" });
  for (const bad of [
    "stremio:///detail/channel/tt0000000",
    "stremio:///detail/movie/file:abc",
    "stremio:///detail/movie/tt0000000/x/y",
    "stremio:///detail/movie/%E0%A4%A",
    "stremio:///detail/movie/tt0000000?autoplay=1",
    "stremio:///search?q=x",
    "stremio:///board",
  ]) {
    expect(parseStremioLink(bad)).toEqual({ kind: "unknown" });
  }
  expect(parseStremioLink("polarity://title/movie/tt0000000")).toBeNull();
  expect(parseStremioLink("https://addon.example.com/manifest.json")).toBeNull();
});

function opener(enabled: boolean) {
  const did: string[] = [];
  const to: StremioOpen = {
    enabled,
    openTitle: (type, id, videoId) => did.push(`title ${type} ${id} ${videoId ?? ""}`.trim()),
    home: (note) => did.push(`home ${note}`),
    offerAddon: (url) => did.push(`offer ${url}`),
  };
  return { did, to };
}

test("each link shape goes where it should, and nowhere while the setting is off", () => {
  const on = opener(true);
  expect(openStremioLink("stremio://addon.example.com/manifest.json", on.to)).toBe(true);
  openStremioLink("stremio:///detail/series/tt0000000/tt0000000:1:2", on.to);
  openStremioLink("stremio:///board", on.to);
  openStremioLink("stremio://localhost:7000/manifest.json", on.to);
  expect(on.did).toEqual([
    "offer https://addon.example.com/manifest.json",
    "title series tt0000000 tt0000000:1:2",
    `home ${STREMIO_NOTES.unknown}`,
    `home ${STREMIO_NOTES.local}`,
  ]);
  expect(openStremioLink("polarity://title/movie/tt0000000", on.to)).toBe(false);

  const off = opener(false);
  openStremioLink("stremio://addon.example.com/manifest.json", off.to);
  openStremioLink("stremio:///detail/movie/tt0000000", off.to);
  expect(off.did).toEqual([`home ${STREMIO_NOTES.off}`, `home ${STREMIO_NOTES.off}`]);
});

function fakeDeps(fail = false) {
  const installed: string[] = [];
  const deps: OfferDeps = {
    preview: async () => (fail ? Promise.reject({ message: "network: error sending request" }) : { name: "Linked Add-on", description: "An add-on." }),
    install: async (url) => void installed.push(url),
  };
  return { installed, deps };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test("an install link never installs without Install being pressed", async () => {
  const { installed, deps } = fakeDeps();
  offerAddon("https://addon.example.com/manifest.json", deps);
  expect(getAddonOffer()?.step).toBe("loading");
  // Install while the manifest is still being read does nothing.
  expect(await confirmAddon(getAddonOffer()?.id ?? 0, deps)).toBeNull();
  await settle();
  expect(getAddonOffer()).toMatchObject({ step: "confirm", name: "Linked Add-on", description: "An add-on.", manifestUrl: "https://addon.example.com/manifest.json" });
  expect(installed).toEqual([]);

  // Cancel: nothing installed.
  dismissAddonOffer();
  expect(getAddonOffer()).toBeNull();
  expect(await confirmAddon(getAddonOffer()?.id ?? 0, deps)).toBeNull();
  expect(installed).toEqual([]);

  // Install pressed: installed once.
  offerAddon("https://addon.example.com/manifest.json", deps);
  await settle();
  expect(await confirmAddon(getAddonOffer()?.id ?? 0, deps)).toBe("Linked Add-on");
  expect(installed).toEqual(["https://addon.example.com/manifest.json"]);
  expect(getAddonOffer()).toBeNull();
});

test("an add-on's name and description are kept to a card's length", async () => {
  const deps: OfferDeps = { preview: async () => ({ name: "N".repeat(300), description: "d ".repeat(2000) }), install: async () => {} };
  offerAddon("https://addon.example.com/manifest.json", deps);
  await settle();
  const shown = getAddonOffer();
  expect(shown?.step).toBe("confirm");
  if (shown?.step !== "confirm") return;
  expect(shown.name.length).toBeLessThanOrEqual(80);
  expect(shown.description!.length).toBeLessThanOrEqual(500);
  expect(shown.name.endsWith("…")).toBe(true);
  dismissAddonOffer();
});

test("a newer link replaces one still asking; an add-on that can't be read can't be installed", async () => {
  const { installed, deps } = fakeDeps();
  offerAddon("https://one.example.com/manifest.json", deps);
  offerAddon("https://two.example.com/manifest.json", deps);
  await settle();
  expect(getAddonOffer()).toMatchObject({ step: "confirm", manifestUrl: "https://two.example.com/manifest.json" });
  dismissAddonOffer();

  // Install pressed on the first card just as a second link replaced it: neither is installed.
  offerAddon("https://one.example.com/manifest.json", deps);
  await settle();
  const pressed = getAddonOffer()!.id;
  offerAddon("https://two.example.com/manifest.json", deps);
  await settle();
  expect(await confirmAddon(pressed, deps)).toBeNull();
  expect(getAddonOffer()).toMatchObject({ step: "confirm", manifestUrl: "https://two.example.com/manifest.json" });
  dismissAddonOffer();

  const broken = fakeDeps(true);
  offerAddon("https://addon.example.com/manifest.json", broken.deps);
  await settle();
  expect(getAddonOffer()).toMatchObject({ step: "error", error: "network: error sending request" });
  expect(await confirmAddon(getAddonOffer()?.id ?? 0, broken.deps)).toBeNull();
  expect(broken.installed).toEqual([]);
  expect(installed).toEqual([]);
  dismissAddonOffer();
});
