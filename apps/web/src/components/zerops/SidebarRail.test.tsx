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
import { waitingItemsOf } from "./SidebarWaiting.logic";

const face = (name: string, projectName: string, extra: Partial<RailMate> = {}): RailMate => ({
  projectId: name.toLowerCase(),
  groupId: projectName.toLowerCase(),
  name,
  projectName,
  tint: "slate",
  shape: "squircle",
  face: "idle",
  dot: undefined,
  owner: undefined,
  line: "",
  ...extra,
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
  await act(async () => {
    root.render(
      <SidebarRail
        account={null}
        activeProjectId="rhea"
        groups={[
          [face("Sage", "Tea Shop"), face("Rhea", "Tea Shop", { dot: "attention" })],
          [face("Noibit", "Ledger API", { line: "Ivy reviews the schema" })],
        ]}
        headline="Ledger API needs attention · 1 more"
        onOpenMenu={onOpenMenu}
        onOverview={onOverview}
        onSelect={onSelect}
        openShortcut="⌘B"
        overviewCurrent={false}
        showMark
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
  return { container, onSelect, onOverview, onOpenMenu };
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
    const { container } = await mount();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/zerops");
    expect(surface(container, "sidebar-rail-waiting")[0]?.textContent).toBe("1");
    expect(tipOf(surface(container, "sidebar-rail-overview")[0])).toContain(
      "Ledger API needs attention · 1 more",
    );
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
      "Rhea, Tea Shop",
      "Noibit, Ledger API",
    ]);
    expect(tipOf(faces[2])).toContain("Noibit · Ledger API");
    expect(tipOf(faces[2])).toContain("Ivy reviews the schema");
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
      groups: [
        [face("Sage", "Tea Shop"), face("Rhea", "Tea Shop")],
        [face("Noibit", "Ledger API")],
        [face("Juno", "")],
      ],
    });
    const projects = surface(container, "sidebar-rail-project").map((project) => ({
      says: [...project.childNodes]
        .filter(
          (node) => !(node instanceof HTMLElement && node.matches('button, [role="tooltip"]')),
        )
        .map((node) => node.textContent)
        .join(""),
      faces: [...project.querySelectorAll('[data-zerops-surface="sidebar-rail-mate"]')].map(
        (mate) =>
          [...mate.childNodes]
            .map((node) => node.textContent ?? "")
            .join("")
            .trim(),
      ),
    }));
    expect(projects).toEqual([
      { says: "Tea Shop", faces: ["", ""] },
      { says: "Ledger API", faces: [""] },
      { says: "", faces: ["Juno"] },
    ]);
  });

  it("marks the open Mate's whole project as the current one", async () => {
    const { container } = await mount();
    expect(
      surface(container, "sidebar-rail-project").map((project) =>
        project.getAttribute("aria-current"),
      ),
    ).toEqual(["true", null]);
  });

  it("opens the menu again from its foot", async () => {
    const { container, onOpenMenu } = await mount();
    await act(async () => {
      surface(container, "sidebar-rail-open")[0]?.click();
    });
    expect(onOpenMenu).toHaveBeenCalled();
  });
});
