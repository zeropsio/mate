// @vitest-environment happy-dom
import type * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({ to, ...props }: React.ComponentProps<"a"> & { to: string }) =>
      createElement("a", { ...props, href: to }),
  };
});
vi.mock("../MateMark", () => ({ MateMark: () => null }));
// Tooltips stand in a portal: here they render in place, so a test reads their words.
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
    TooltipProvider: ({ children }: { children?: React.ReactNode }) =>
      createElement(Fragment, null, children),
  };
});

import { SidebarRail, type RailMate } from "./SidebarRail";
import { railTiles } from "./SidebarRail.logic";
import { waitingItemsOf } from "./SidebarWaiting.logic";

const face = (name: string, projectName: string, extra: Partial<RailMate> = {}): RailMate => ({
  projectId: name.toLowerCase(),
  groupId: projectName.toLowerCase(),
  name,
  projectName,
  tint: "slate",
  shape: "squircle",
  face: "idle",
  known: true,
  dot: undefined,
  badge: null,
  mine: true,
  asksViewer: false,
  at: undefined,
  working: false,
  runSince: undefined,
  line: "",
  ...extra,
});

const TEA_SHOP = [face("Sage", "Tea Shop"), face("Rhea", "Tea Shop", { dot: "attention" })];
const LEDGER = [face("Noibit", "Ledger API", { line: "Ivy reviews the schema" })];
/** The tiles of these Mates, in this order, Tea Shop open as its person left it. */
const tilesOf = (
  mates: ReadonlyArray<RailMate>,
  active: string | null = "rhea",
  opened: ReadonlyArray<string> = ["tea shop"],
) =>
  railTiles({
    mates,
    order: mates.map((mate) => mate.projectId),
    folds: { closed: new Set(), opened: new Set(opened) },
    active,
  });

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

async function mount(props: Partial<React.ComponentProps<typeof SidebarRail>> = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  const onOverview = vi.fn();
  const onOpenMenu = vi.fn();
  const onFold = vi.fn();
  await act(async () => {
    root.render(
      <SidebarRail
        account={null}
        activeProjectId="rhea"
        headline="Ledger API needs attention · 1 more"
        onFold={onFold}
        onOpenMenu={onOpenMenu}
        onOverview={onOverview}
        onSelect={onSelect}
        openShortcut="⌘B"
        overviewCurrent={false}
        showMark
        tiles={tilesOf([...TEA_SHOP, ...LEDGER])}
        verbs={{ onOpenMate: () => {}, onAskToFix: () => {} }}
        waiting={waitingItemsOf({
          mates: [],
          releases: [{ groupId: "tea", name: "Tea Shop", ahead: 3 }],
        })}
        {...props}
      />,
    );
  });
  unmounts.push(() => {
    root.unmount();
    container.remove();
  });
  return { container, onSelect, onOverview, onOpenMenu, onFold };
}

const surface = (container: HTMLElement, name: string) => [
  ...container.querySelectorAll<HTMLElement>(`[data-zerops-surface="${name}"]`),
];
/** The tooltip a control wears, drawn beside it. */
const tipOf = (control: Element | undefined) =>
  control?.nextElementSibling?.getAttribute("role") === "tooltip"
    ? control.nextElementSibling.textContent
    : undefined;

describe("SidebarRail — the closed menu on a desktop", () => {
  it("leads with the mark to the overview, the waiting count and Overview", async () => {
    const { container, onOverview } = await mount();
    const overview = surface(container, "sidebar-rail-overview")[0];
    expect(overview?.getAttribute("aria-label")).toBe("Overview");
    expect(tipOf(overview)).toContain("Ledger API needs attention · 1 more");
    expect(surface(container, "sidebar-rail-waiting")[0]?.textContent).toBe("1");
    await act(async () => {
      overview?.click();
    });
    expect(onOverview).toHaveBeenCalled();
  });

  it("puts the Chief in Overview's place where the organization holds one", async () => {
    const { container } = await mount({
      chief: <button data-zerops-surface="sidebar-chief-row" type="button" />,
    });
    expect(surface(container, "sidebar-chief-row")).toHaveLength(1);
    expect(surface(container, "sidebar-rail-overview")).toHaveLength(0);
    expect(surface(container, "sidebar-rail-waiting")).toHaveLength(0);
  });

  it("draws no count while nothing waits", async () => {
    const { container } = await mount({ waiting: [] });
    expect(surface(container, "sidebar-rail-waiting")).toHaveLength(0);
  });

  it("names each face by its Mate and project, its line in its tooltip", async () => {
    const { container } = await mount();
    const faces = surface(container, "sidebar-rail-mate");
    expect(faces.map((entry) => entry.getAttribute("aria-label"))).toEqual([
      "Sage, Tea Shop",
      "Rhea, Tea Shop, Waiting for you",
      "Noibit, Ledger API",
    ]);
    expect(tipOf(faces[2])).toContain("Ledger API");
    expect(tipOf(faces[2])).toContain("Noibit");
    expect(tipOf(faces[2])).toContain("Ivy reviews the schema");
  });

  it("says a tile's state in words in its card", async () => {
    const { container } = await mount();
    expect(tipOf(surface(container, "sidebar-rail-mate")[1])).toContain("Waiting for you");
    expect(tipOf(surface(container, "sidebar-rail-group")[0])).toContain("Rhea");
    expect(tipOf(surface(container, "sidebar-rail-group")[0])).toContain("Waiting for you");
  });

  it("marks the open Mate's face, and opens a Mate from its face", async () => {
    const { container, onSelect } = await mount();
    const faces = surface(container, "sidebar-rail-mate");
    expect(faces.map((entry) => entry.getAttribute("aria-current"))).toEqual([null, "page", null]);
    await act(async () => {
      faces[2]?.click();
    });
    expect(onSelect).toHaveBeenCalledWith("noibit");
  });

  // The owner (2026-10-12): "you absolutely do not identify your mate by the name, shape or
  // color, it's the project what is the main identifier".
  it("heads each project's faces with the project's name, a Mate in no project with its own", async () => {
    const { container } = await mount({
      tiles: tilesOf(
        [face("Sage", "Tea Shop"), face("Rhea", "Tea Shop"), ...LEDGER, face("Juno", "")],
        null,
        [],
      ),
    });
    const names = surface(container, "sidebar-rail-project").map(
      (project) => project.querySelector('[data-zerops-surface="sidebar-rail-name"]')?.textContent,
    );
    expect(names).toEqual(["Tea Shop", "Ledger API", "Juno"]);
  });

  it("marks the open Mate's whole project as the current one", async () => {
    const { container } = await mount();
    expect(
      surface(container, "sidebar-rail-project").map((project) =>
        project.getAttribute("aria-current"),
      ),
    ).toEqual(["true", null]);
  });

  it("opens and folds a group in place with the menu's fold, its Mates' tiles under it", async () => {
    const folded = await mount({ tiles: tilesOf([...TEA_SHOP, ...LEDGER], null, []) });
    expect(surface(folded.container, "sidebar-rail-mate")).toHaveLength(1);
    const group = surface(folded.container, "sidebar-rail-group")[0];
    expect(group?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      group?.click();
    });
    expect(folded.onFold).toHaveBeenCalledWith("tea shop", true);

    const open = await mount({ tiles: tilesOf([...TEA_SHOP, ...LEDGER], null) });
    expect(surface(open.container, "sidebar-rail-group")[0]?.getAttribute("aria-expanded")).toBe(
      "true",
    );
    await act(async () => {
      surface(open.container, "sidebar-rail-group")[0]?.click();
    });
    expect(open.onFold).toHaveBeenCalledWith("tea shop", false);
    expect(open.onSelect).not.toHaveBeenCalled();
  });

  it("wears one dot per tile, its state's", async () => {
    const { container } = await mount({
      tiles: tilesOf(
        [
          face("Sage", "Tea Shop", { dot: "working" }),
          face("Rhea", "Tea Shop", { dot: "failed" }),
          face("Noibit", "Ledger API", { dot: "unread" }),
          face("Juno", "", { dot: "working" }),
          face("Vesta", ""),
        ],
        null,
        [],
      ),
    });
    expect(
      surface(container, "sidebar-rail-project").map((project) =>
        [...project.querySelectorAll("[data-dot]")]
          .filter((dot) => dot.closest('[role="tooltip"]') === null)
          .map((dot) => dot.getAttribute("data-dot")),
      ),
    ).toEqual([["failed"], ["unread"], ["working"], []]);
  });

  it("opens the menu again from its foot", async () => {
    const { container, onOpenMenu } = await mount();
    await act(async () => {
      surface(container, "sidebar-rail-open")[0]?.click();
    });
    expect(onOpenMenu).toHaveBeenCalled();
  });
});
