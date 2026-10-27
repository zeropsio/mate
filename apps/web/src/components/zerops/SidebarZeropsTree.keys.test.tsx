// @vitest-environment happy-dom
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SidebarZeropsTree } from "./SidebarZeropsTree";

/** A Mate in the project Orbit, named `name`. */
const mate = (id: string, name: string): ZeropsCandidate => ({
  key: `${id}:zcp`,
  project: {
    id,
    name,
    status: "ACTIVE",
    tagList: ["mate"],
    hq: { appId: "orbit", appName: "Orbit", kind: "mate", mate: { face: "" } },
  },
  group: "ready",
  service: { id: "zcp", name: "zcp", status: "ACTIVE" },
});

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

/** The menu drawn in a page: Orbit of two Mates, then Lumen of one. */
async function menu() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <SidebarZeropsTree
        candidates={[
          mate("orbit-vira", "Vira"),
          mate("orbit-sid", "Sid"),
          {
            ...mate("lumen-ada", "Ada"),
            project: {
              ...mate("lumen-ada", "Ada").project,
              hq: { appId: "lumen", appName: "Lumen", kind: "mate", mate: { face: "" } },
            },
          },
        ]}
        complete
        onBrowseProjects={() => {}}
        onSelect={() => {}}
      />,
    );
  });
  unmounts.push(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });
  const group = () =>
    container.querySelector<HTMLElement>(
      '[data-zerops-group="orbit"] [data-zerops-surface="sidebar-project"]',
    )!;
  const kids = () => [
    ...container.querySelectorAll<HTMLElement>(
      '[data-zerops-group="orbit"] [data-zerops-surface="sidebar-mate"]',
    ),
  ];
  const press = async (target: HTMLElement, key: string) => {
    target.focus();
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  };
  return { container, group, kids, press };
}

describe("the menu's keys on a group and its Mates", () => {
  it("opens a folded group on →, and on its open row steps into its first Mate", async () => {
    const { group, kids, press } = await menu();
    expect(group().getAttribute("aria-expanded")).toBe("false");
    expect(kids()).toHaveLength(0);
    await press(group(), "ArrowRight");
    expect(group().getAttribute("aria-expanded")).toBe("true");
    expect(kids()).toHaveLength(2);
    await press(group(), "ArrowRight");
    expect(document.activeElement).toBe(kids()[0]);
  });

  it("folds an open group on ←, and on a Mate under it steps out to its group's row", async () => {
    const { group, kids, press } = await menu();
    await press(group(), "ArrowRight");
    await press(kids()[1]!, "ArrowLeft");
    expect(document.activeElement).toBe(group());
    expect(group().getAttribute("aria-expanded")).toBe("true");
    await press(group(), "ArrowLeft");
    expect(group().getAttribute("aria-expanded")).toBe("false");
  });

  it("moves over every row drawn with ↓ and ↑, groups' and Mates' alike", async () => {
    const { container, group, kids, press } = await menu();
    await press(group(), "ArrowRight");
    const rows = () => [...container.querySelectorAll<HTMLElement>("[data-zerops-row]")];
    expect(rows()).toHaveLength(4);
    await press(group(), "ArrowDown");
    expect(document.activeElement).toBe(kids()[0]);
    // From each row, the next and the one before, wherever Orbit stands among the projects.
    const at = rows().indexOf(group());
    await press(kids()[1]!, "j");
    expect(document.activeElement).toBe(rows()[Math.min(at + 3, 3)]);
    await press(kids()[1]!, "k");
    expect(document.activeElement).toBe(kids()[0]);
    await press(kids()[0]!, "ArrowUp");
    expect(document.activeElement).toBe(group());
  });
});
