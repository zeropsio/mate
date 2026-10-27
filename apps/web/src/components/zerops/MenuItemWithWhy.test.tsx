// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vite-plus/test";

import { Menu, MenuPopup } from "../ui/menu";
import { MenuItemWithWhy } from "./MenuItemWithWhy";

it("A menu item that stands off shows its reason under its label, as its accessible description", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const why = "Nova is still setting Shop Front up. New Mates can join once it's done.";
  await act(async () =>
    root.render(
      <Menu open>
        <MenuPopup>
          <MenuItemWithWhy disabled label="Add a project Mate" onClick={() => {}} why={why} />
          <MenuItemWithWhy label="Open project" onClick={() => {}} why={undefined} />
        </MenuPopup>
      </Menu>,
    ),
  );
  const items = [...document.querySelectorAll('[data-slot="menu-item"]')];
  const off = items.find((item) => item.textContent?.startsWith("Add a project Mate"));
  const describedBy = off?.getAttribute("aria-describedby");
  expect(off?.textContent).toBe(`Add a project Mate${why}`);
  expect(describedBy == null ? null : document.getElementById(describedBy)?.textContent).toBe(why);
  const open = items.find((item) => item.textContent === "Open project");
  expect(open?.hasAttribute("aria-describedby")).toBe(false);
  await act(async () => root.unmount());
  host.remove();
});
