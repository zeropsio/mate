// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SidebarChiefRow, SidebarChiefTile } from "./SidebarChiefRow";

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

async function mount(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  unmounts.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

const press = async (element: Element | null | undefined) => {
  await act(async () => {
    (element as HTMLElement | null)?.click();
  });
};

// The owner, 2026-10-15: "unread is not highlighted at all". The Chief is a Mate: a result of it
// not seen wears the unread dot on its mark, as a Mate's face on the rail does.
describe("the Chief's row", () => {
  it.each([
    { case: "its row", Row: SidebarChiefRow, unseen: true },
    { case: "its row, everything seen", Row: SidebarChiefRow, unseen: false },
    { case: "its tile on the rail", Row: SidebarChiefTile, unseen: true },
    { case: "its tile on the rail, everything seen", Row: SidebarChiefTile, unseen: false },
  ])("An unread Chief shows its dot: $case", ({ Row, unseen }) => {
    const html = renderToStaticMarkup(
      <Row current={false} face="done" onOpen={() => {}} unseen={unseen} />,
    );
    expect(html.includes('data-zerops-surface="sidebar-chief-unread"')).toBe(unseen);
  });

  it("carries no menu where nobody may remove the Chief", () => {
    const html = renderToStaticMarkup(<SidebarChiefRow current={false} onOpen={() => {}} />);
    expect(html).not.toContain('data-zerops-surface="sidebar-chief-more"');
  });

  it("removes the organization's Chief from its menu's Remove as Chief", async () => {
    const onRemove = vi.fn();
    const onOpen = vi.fn();
    const container = await mount(
      <SidebarChiefRow current={false} onOpen={onOpen} onRemove={onRemove} />,
    );
    await press(container.querySelector('[data-zerops-surface="sidebar-chief-more"]'));
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (element) => element.textContent === "Remove as Chief",
    );
    await press(item);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
