import { expect, test } from "bun:test";
import { act, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingRow } from "../../src/components/settings/SettingRow";
import { MenuCheckItem, MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "../../src/components/ui/Menu";
import { getPrefs } from "../../src/lib/settings/prefs";
import { dismissDepth } from "../../src/lib/ui/dismiss";
import { byText, click, press, render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

function TitleMenu({ onPick }: { onPick: (what: string) => void }) {
  const [watched, setWatched] = useState(false);
  return (
    <MenuRoot>
      <MenuTrigger>More</MenuTrigger>
      <MenuPopup aria-label="Title actions">
        <MenuItem onClick={() => onPick("library")}>Add to Library</MenuItem>
        <MenuItem disabled onClick={() => onPick("download")}>
          Download
        </MenuItem>
        <MenuCheckItem checked={watched} onCheckedChange={setWatched}>
          Watched
        </MenuCheckItem>
      </MenuPopup>
    </MenuRoot>
  );
}

test("Menu: the trigger opens it, an item runs and closes it, a disabled item does nothing", async () => {
  const picked: string[] = [];
  const { container } = await render(<TitleMenu onPick={(w) => picked.push(w)} />);
  await click(byText(container, "button", "More"));
  await settle();
  const menu = document.querySelector("[role=menu]")!;
  expect(menu).not.toBeNull();
  expect(menu.getAttribute("aria-label")).toBe("Title actions");
  expect(menu.className).toBe("menu menu-compact");
  const items = [...menu.querySelectorAll<HTMLElement>("[role^=menuitem]")];
  expect(items.map((i) => i.textContent)).toEqual(["Add to Library", "Download", "Watched"]);

  await click(items[1]);
  expect(picked).toEqual([]);

  await click(items[2]);
  await settle();
  expect(document.querySelector("[role=menuitemcheckbox]")!.getAttribute("aria-checked")).toBe("true");

  await click(document.querySelector("[role=menuitem]"));
  await settle();
  expect(picked).toEqual(["library"]);
  expect(document.querySelector("[role=menu]")).toBeNull();
});

test("Menu: Escape closes the open menu by itself and leaves the layer stack alone", async () => {
  const { container } = await render(<TitleMenu onPick={() => {}} />);
  await click(byText(container, "button", "More"));
  await settle();
  expect(document.querySelector("[role=menu]")).not.toBeNull();
  let reachedApp = 0;
  const app = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && reachedApp++;
  window.addEventListener("keydown", app);
  await press("Escape", document.activeElement ?? document.querySelector("[role=menu]")!);
  await settle();
  window.removeEventListener("keydown", app);
  expect(document.querySelector("[role=menu]")).toBeNull();
  expect(dismissDepth()).toBe(0);
  expect(reachedApp).toBe(0);
});

test("SettingRow: a schema toggle draws its title and caption, and switching it stores the pref", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const changed: unknown[] = [];
  const { container } = await render(
    <QueryClientProvider client={client}>
      <SettingRow id="pauseOnMinimize" onChanged={(v) => changed.push(v)} />
    </QueryClientProvider>,
  );
  const row = container.querySelector("[data-setting=pauseOnMinimize]")!;
  expect(row.querySelector(".settings-row-title")!.textContent).toBe("Pause when minimized");
  expect(row.querySelector(".settings-row-caption")!.textContent).toBe("On this device");
  const input = row.querySelector<HTMLInputElement>("input[role=switch]")!;
  expect(input.checked).toBe(false);
  await click(row);
  expect(input.checked).toBe(true);
  expect(getPrefs().pauseOnMinimize).toBe(true);
  expect(changed).toEqual([true]);
  client.clear();
});
