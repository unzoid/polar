import { afterEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { PartyMenu } from "../../src/components/party/PartyMenu";
import { getParty, leaveParty, startParty, useParty, type PartyState } from "../../src/lib/party";
import { DEFAULT_RULES } from "../../src/lib/party/messages";
import { queryClient } from "../../src/lib/net";
import { RouterProvider, type Route } from "../../src/lib/router";
import { byText, click, render } from "./render";

// The party menu (#156) on the app's own room, opened by this member (so it hosts). No account backend
// here, so nothing leaves the room: what's checked is what the menu shows and what its controls change.

const MEDIA = { type: "series" as const, metaId: "tt0000156", videoId: "tt0000156:1:3", label: "S1:E3 · The Harbour Light" };

function Live() {
  const party = useParty();
  return party ? <PartyMenu party={party} /> : <p>Not in a party</p>;
}

const at = (route: Route, node = <Live />) => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider initial={[route]}>{node}</RouterProvider>
  </QueryClientProvider>
);

const switchFor = (root: ParentNode, label: string) => byText(root, ".party-switch-text > span:first-child", label).closest("label")!.querySelector("input")!;

afterEach(() => {
  leaveParty();
  document.body.innerHTML = "";
});

test("away from the room's video: what's on, Go to the Current Stream, the code, and the host's controls", async () => {
  startParty(MEDIA, 754, true, { name: "Ash", avatar: "" });
  const { container } = await render(at({ name: "home" }));
  const text = container.textContent!;
  expect(text).toContain("S1 E3 · The Harbour Light");
  expect(text).toContain("Paused · 12:34");
  expect(text).toContain("Host · Paused");
  expect(byText(container, "button", "Go to the Current Stream")).toBeTruthy();
  expect(text).not.toContain("Sync Now");
  expect(container.querySelectorAll(".party-code > span")).toHaveLength(6);
  expect(text).toContain("Host controls");
});

test("in the player on the room's video: Sync Now instead of going there", async () => {
  startParty(MEDIA, 0, false, { name: "Ash", avatar: "" });
  const { container } = await render(at({ name: "player", type: MEDIA.type, metaId: MEDIA.metaId, videoId: MEDIA.videoId }));
  expect(byText(container, "button", "Sync Now")).toBeTruthy();
  expect(container.textContent).not.toContain("Go to the Current Stream");
});

test("the host's switches change the room's rules, and mute is the viewer's own", async () => {
  startParty(MEDIA, 0, false, { name: "Ash", avatar: "" });
  const { container } = await render(at({ name: "home" }));
  await click(switchFor(container, "Lock party"));
  await click(switchFor(container, "Only I control playback"));
  await click(switchFor(container, "Wait for everyone"));
  await click(switchFor(container, "Approve joins"));
  expect(getParty()!.rules).toMatchObject({ locked: true, control: "host", wait: false, approve: true });
  expect(getParty()!.rules.v).toBe(5);
  await click(switchFor(container, "Mute party sounds"));
  expect(getParty()!.quiet).toBe(true);
});

test("End Party asks once more before ending it for everyone", async () => {
  startParty(MEDIA, 0, false, { name: "Ash", avatar: "" });
  const { container } = await render(at({ name: "home" }));
  await click(byText(container, "button", "End Party"));
  expect(getParty()).not.toBeNull();
  await click(byText(container, "button", "End for Everyone?"));
  expect(getParty()).toBeNull();
  expect(container.textContent).toContain("Not in a party");
});

test("a member sees no host controls and no per-member actions; joiners waiting are the host's to answer", async () => {
  const m = (id: string, name: string) => ({ id, name, avatar: "", joinedAt: Number(id.slice(1)), waiting: false });
  const member: PartyState = {
    code: "K7MPQ4",
    status: "live",
    me: "m2",
    hostId: "m1",
    members: [m("m1", "Ash"), m("m2", "Bea"), { ...m("m3", "Cy"), lost: true }],
    playback: { v: 2, by: "m1", media: MEDIA, paused: false, held: false, position: 60, lag: 0, at: performance.now() },
    notes: [],
    rules: { ...DEFAULT_RULES, v: 2 },
    knocking: false,
    knockers: [{ ...m("m4", "Dee"), knock: true }],
    positions: {},
    quiet: false,
    resync: 0,
  };
  const { container } = await render(at({ name: "home" }, <PartyMenu party={member} />));
  const text = container.textContent!;
  expect(text).not.toContain("Host controls");
  expect(text).not.toContain("Let In");
  expect(text).not.toContain("Dee");
  expect(container.querySelector(".party-member-more")).toBeNull();
  expect(text).toContain("Host · Watching");
  expect(text).toContain("Disconnected");
  expect(byText(container, "button", "Leave Party")).toBeTruthy();
});
