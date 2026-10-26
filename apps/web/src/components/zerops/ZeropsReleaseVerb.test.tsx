// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vite-plus/test";
import { ReleaseAction, ZeropsReleaseVerb } from "./ZeropsReleaseVerb";

import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";
import { AccountDataContext, type AccountData } from "~/zerops/ZeropsAccountData";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ReviewContext } from "~/zerops/review";

vi.mock("~/zerops/ZeropsSessionProvider", async (original) => ({
  ...(await original<typeof import("~/zerops/ZeropsSessionProvider")>()),
  useZeropsSession: () => ({ status: "signed-in", activeOrganization: { id: "org" } }),
  useZeropsSessionOptional: () => ({ status: "signed-in", activeOrganization: { id: "org" } }),
}));
vi.mock("~/zerops/accountHq", () => ({
  useAccountHq: () => ({ hq: { kind: "official", address: "https://hq.test" } }),
}));
vi.mock("~/zerops/flowVerbs", () => ({
  useFlowVerbs: () => ({ pending: new Set() }),
}));

it.each([false, true])(
  "Opening an overview shows the release offer without reading a repository.",
  async (arrivesAfterPaint) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const registry = AtomRegistry.make();
    const structure = {
      apps: [{ id: "app", name: "Shop", projects: [], environments: [] }],
      ungrouped: [],
    };
    const offer = {
      head: "a".repeat(40),
      suggestion: "v1.2.3",
      gate: { allow: true },
      inFlight: null,
      summary: { total: 2, more: 0, subjects: ["Quicker checkout", "Fix VAT"], atLeast: false },
    } as const;
    const { store, seed } = mountHqNavigation(registry, "org", {
      structure,
      releaseOffers: { app: arrivesAfterPaint ? null : offer },
    });
    const inventory: Inventory = {
      projects: [],
      projectRefs: new Map(),
      authority: new Map(),
      lost: new Set(),
      deleted: [],
      isLoading: false,
      error: null,
    };
    const demandDetail = vi.fn(() => () => {});
    const compare = vi.fn<AccountData["compare"]>();
    const account: AccountData = {
      data: store.data,
      orgId: "org",
      logs: null,
      demandDetail,
      compare,
      renewHeld: vi.fn(),
      retry: vi.fn(),
      showHq: vi.fn(),
      moveOffers: vi.fn(),
      handoverCandidates: vi.fn(),
      readDetail: vi.fn(),
      revalidate: vi.fn(),
      retryDetail: vi.fn(),
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const openReview = vi.fn();
    try {
      await act(async () =>
        root.render(
          <RegistryContext.Provider value={registry}>
            <AccountDataContext.Provider value={account}>
              <InventoryContext.Provider value={inventory}>
                <ReviewContext.Provider value={openReview}>
                  <ZeropsReleaseVerb groupId="app" label="Review release" />
                </ReviewContext.Provider>
              </InventoryContext.Provider>
            </AccountDataContext.Provider>
          </RegistryContext.Provider>,
        ),
      );
      if (arrivesAfterPaint) {
        expect(container.querySelector("button")).toBeNull();
        await act(async () => seed({ structure, releaseOffers: { app: offer } }));
      }
      expect(container.querySelector("button")?.textContent).toBe("Review release");
      expect(demandDetail).not.toHaveBeenCalled();
      expect(compare).not.toHaveBeenCalled();
      expect(openReview).not.toHaveBeenCalled();
      const button = container.querySelector("button")!;
      await act(async () => button.click());
      expect(openReview).toHaveBeenCalledExactlyOnceWith(
        { kind: "release", groupId: "app" },
        { from: button },
      );
      await act(async () =>
        seed({
          structure,
          releaseOffers: {
            app: { ...offer, gate: { allow: false, reason: "Nothing waits for release." } },
          },
        }),
      );
      expect(container.querySelector("button")).toBeNull();
      expect(compare).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      registry.dispose();
      vi.unstubAllGlobals();
    }
  },
);

describe("the release review door", () => {
  it.each([
    { offered: false, releasing: false, shown: false },
    { offered: true, releasing: false, shown: true },
    { offered: false, releasing: true, shown: true },
  ])("offered=$offered, releasing=$releasing", async ({ offered, releasing, shown }) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onReview = vi.fn();
    try {
      await act(async () => {
        root.render(
          <ReleaseAction
            label="Review release"
            release={{ offered, releasing, tag: undefined, reason: undefined, onReview }}
          />,
        );
      });
      const button = container.querySelector("button");
      expect(button !== null).toBe(shown);
      expect(onReview).not.toHaveBeenCalled();
      if (button !== null) {
        if (!releasing) expect(button.textContent).toBe("Review release");
        await act(async () => button.click());
        expect(onReview).toHaveBeenCalledExactlyOnceWith(button);
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
