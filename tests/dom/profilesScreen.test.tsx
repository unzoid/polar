import { expect, test } from "bun:test";
import { AccountContext, type Account } from "../../src/lib/account/AccountProvider";
import type { Profile } from "../../src/lib/account/backend";
import { ProfilesScreen } from "../../src/screens/account/ProfilesScreen";
import { byText, click, render } from "./render";

const profile = (id: string, name: string) => ({ id, name, avatar: "fox" }) as unknown as Profile;
const account = {
  profiles: [profile("p1", "Ada"), profile("p2", "Ben")],
  lastProfileId: "p1",
  signOut: async () => {},
  chooseProfile: async () => {},
} as unknown as Account;

test("Manage Profiles and Done switch modes in place: same screen and tiles, focus stays on the button (#93)", async () => {
  const { container, unmount } = await render(
    <AccountContext.Provider value={account}>
      <ProfilesScreen />
    </AccountContext.Provider>,
  );
  const screen = container.querySelector(".profiles");
  const tile = container.querySelector(".profile-tile");
  const manage = byText(container, "button", "Manage Profiles");
  manage.focus();
  await click(manage);
  expect(container.querySelector(".profiles")).toBe(screen);
  expect(container.querySelector(".profile-tile")).toBe(tile);
  expect(container.querySelector("h1")!.textContent).toBe("Manage Profiles");
  expect(tile!.getAttribute("aria-label")).toBe("Edit Ada");
  const done = byText(container, "button", "Done");
  expect(document.activeElement).toBe(done);
  await click(done);
  expect(container.querySelector(".profiles")).toBe(screen);
  expect(container.querySelector(".profile-tile")).toBe(tile);
  expect(container.querySelector("h1")!.textContent).toBe("Who's watching?");
  expect(document.activeElement).toBe(byText(container, "button", "Manage Profiles"));
  await unmount();
});
