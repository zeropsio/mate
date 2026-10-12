// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SidebarProvider } from "../ui/sidebar";
import { SidebarStage, sidebarMenuShown } from "./SidebarStage";

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

async function mount(open: boolean) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <SidebarProvider defaultOpen={open}>
        <SidebarStage rail={<button type="button">Ada's face</button>}>
          <button type="button">Ada's row</button>
        </SidebarStage>
      </SidebarProvider>,
    );
  });
  unmounts.push(() => {
    root.unmount();
    container.remove();
  });
  return container;
}

const button = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll("button")].find((entry) => entry.textContent === name)!;

describe("SidebarStage — the closed menu over the open one", () => {
  // The tree's own keys (⌥1–9 opens the nth Mate, j/k walk the rows) read this: on origin the
  // tree was not there at all while the menu was closed.
  it("keeps the open menu waiting under the rail out of the keyboard's reach", async () => {
    const container = await mount(false);
    expect(sidebarMenuShown()).toBe(false);
    expect(button(container, "Ada's row").closest("[inert]")).not.toBeNull();
    expect(button(container, "Ada's face").closest("[inert]")).toBeNull();
  });

  it("gives the docked menu to the keyboard, and the rail under it none", async () => {
    const container = await mount(true);
    expect(sidebarMenuShown()).toBe(true);
    expect(button(container, "Ada's row").closest("[inert]")).toBeNull();
    expect(button(container, "Ada's face").closest("[inert]")).not.toBeNull();
  });
});
