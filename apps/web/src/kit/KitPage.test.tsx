// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { KIT_GROUPS, KIT_KINDS } from "./kitSection";
import { KitPage } from "./KitPage";
import { KIT_SECTIONS } from "./registry";

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("KitPage", () => {
  it("The kit page shows every registered section", async () => {
    // The page's toasts read the route, as they do in the app.
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/kit"] }),
      routeTree: createRootRoute({
        component: () => <KitPage onViewChange={() => {}} pane={false} view="light" />,
      }),
    });
    await act(() => router.load());
    await act(() => root.render(<RouterProvider router={router} />));

    expect(KIT_SECTIONS.length).toBeGreaterThan(0);
    const shown = KIT_SECTIONS.filter((section) => {
      const element = document.getElementById(section.id);
      return element !== null && !element.textContent?.includes("failed to render");
    }).map((section) => section.id);
    expect(shown).toEqual(KIT_SECTIONS.map((section) => section.id));
    expect(document.getElementById("not-shown")).not.toBeNull();
  });

  it("gives every section a unique anchor and a known group and kind", () => {
    const ids = KIT_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of KIT_SECTIONS) {
      expect(KIT_GROUPS).toContain(section.group);
      expect(KIT_KINDS).toContain(section.kind);
    }
  });
});
