// @vitest-environment happy-dom
import type * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// The menu and the tooltip stand in portals: here every part renders in place, so a test reads
// and presses what the open menu holds.
vi.mock("../ui/menu", async () => {
  const { createElement, Fragment } = await import("react");
  const inPlace = ({ children }: { children?: React.ReactNode }) =>
    createElement(Fragment, null, children);
  return {
    Menu: inPlace,
    MenuPopup: inPlace,
    MenuSub: inPlace,
    MenuSubPopup: inPlace,
    MenuSubTrigger: ({ children }: { children?: React.ReactNode }) =>
      createElement("div", { "data-sub": "" }, children),
    MenuTrigger: ({ render }: { render: React.ReactElement }) => render,
    MenuItem: ({ children, ...props }: React.ComponentProps<"button">) =>
      createElement("button", { ...props, type: "button" }, children),
  };
});
vi.mock("../ui/tooltip", async () => {
  const { createElement, Fragment } = await import("react");
  return {
    Tooltip: ({ children }: { children?: React.ReactNode }) =>
      createElement(Fragment, null, children),
    TooltipTrigger: ({
      render,
      children,
    }: {
      render: React.ReactElement;
      children?: React.ReactNode;
    }) => createElement(render.type, render.props as object, children),
    TooltipPopup: ({ children }: { children?: React.ReactNode }) =>
      createElement("span", { role: "tooltip" }, children),
  };
});
vi.mock("../ui/sidebar", () => ({}));
vi.mock("@tanstack/react-router", () => ({ Link: () => null, useLocation: () => false }));

import { SidebarCreateButton } from "./SidebarChrome";

const roots: Array<() => void> = [];
afterEach(() => {
  for (const unmount of roots.splice(0)) unmount();
});

async function mount(projects: ReadonlyArray<{ readonly id: string; readonly name: string }>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onNewMate = vi.fn();
  const onNewProject = vi.fn();
  await act(async () => {
    root.render(
      <SidebarCreateButton onNewMate={onNewMate} onNewProject={onNewProject} projects={projects} />,
    );
  });
  roots.push(() => {
    root.unmount();
    container.remove();
  });
  return { container, onNewMate, onNewProject };
}

describe("SidebarCreateButton — the top row's +", () => {
  it("is named for what it makes, in its tooltip too", async () => {
    const { container } = await mount([{ id: "tea", name: "Tea Shop" }]);
    const plus = container.querySelector('[data-zerops-surface="sidebar-create"]');
    expect(plus?.getAttribute("aria-label")).toBe("New Mate or project");
    expect(container.querySelector('[role="tooltip"]')?.textContent).toBe("New Mate or project");
  });

  it("asks for a New project in the menu's own flow", async () => {
    const { container, onNewProject } = await mount([{ id: "tea", name: "Tea Shop" }]);
    await act(async () => {
      container.querySelector<HTMLElement>('[data-zerops-create="project"]')?.click();
    });
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });

  it("asks for a New Mate in the one project there is, at once", async () => {
    const { container, onNewMate } = await mount([{ id: "tea", name: "Tea Shop" }]);
    await act(async () => {
      container.querySelector<HTMLElement>('[data-zerops-create="mate"]')?.click();
    });
    expect(onNewMate).toHaveBeenCalledWith("tea");
  });

  it("lists the projects a New Mate may be asked in, where there are several", async () => {
    const { container, onNewMate } = await mount([
      { id: "ledger", name: "Ledger API" },
      { id: "tea", name: "Tea Shop" },
    ]);
    const choices = [...container.querySelectorAll<HTMLElement>("[data-zerops-create-in]")];
    expect(choices.map((choice) => choice.textContent)).toEqual(["Ledger API", "Tea Shop"]);
    await act(async () => {
      choices[1]?.click();
    });
    expect(onNewMate).toHaveBeenCalledWith("tea");
  });

  it("offers only New project while there is no project to put a Mate in", async () => {
    const { container } = await mount([]);
    expect(container.querySelector('[data-zerops-create="mate"]')).toBeNull();
    expect(container.querySelector('[data-zerops-create="project"]')).not.toBeNull();
  });
});
