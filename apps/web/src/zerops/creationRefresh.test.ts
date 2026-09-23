import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  makeZeropsApiOrigin,
  type OrganizationRef,
} from "@t3tools/client-runtime/zerops/data";
import type { Invalidation } from "@t3tools/client-runtime/zerops/knowledge";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";
import { onZeropsInvalidation } from "./accountInvalidations";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  CREATION_REFRESH_MS,
  creationRefreshWanted,
  useCreationInventoryRefresh,
} from "./creationRefresh";

const organization: OrganizationRef = {
  kind: "organization",
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account"),
  },
  organizationId: ZeropsOrganizationId.make("org-1"),
};

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  closeAccountLifetime();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("creationRefreshWanted", () => {
  // The owner's run of 2026-09-17: the card waited at "Almost there." on a
  // Mate that had answered minutes earlier, because the pushed inventory had
  // not delivered its container; a reload found it at once.
  const cases = [
    {
      name: "a creation this browser has not connected to yet",
      creationPending: true,
      waitPhase: null,
      want: true,
    },
    {
      name: "a wait still looking for its project",
      creationPending: false,
      waitPhase: "awaiting-project",
      want: true,
    },
    {
      name: "a wait still looking for its container",
      creationPending: false,
      waitPhase: "awaiting-container",
      want: true,
    },
    {
      name: "a wait still settling before it can be hardened",
      creationPending: false,
      waitPhase: "awaiting-settled",
      want: true,
    },
    {
      name: "a wait running the birth's one restart",
      creationPending: false,
      waitPhase: "hardening",
      want: true,
    },
    {
      name: "a wait already probing the container by HTTP",
      creationPending: false,
      waitPhase: "awaiting-health",
      want: false,
    },
    { name: "a wait that has settled", creationPending: false, waitPhase: "ready", want: false },
    { name: "nothing on its way", creationPending: false, waitPhase: null, want: false },
  ] as const;

  for (const tc of cases) {
    it(tc.name, () => {
      expect(
        creationRefreshWanted({ creationPending: tc.creationPending, waitPhase: tc.waitPhase }),
      ).toBe(tc.want);
    });
  }
});

describe("useCreationInventoryRefresh", () => {
  it("asks for the creating organization's inventory on its clock, and for nothing else", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    vi.spyOn(process.hrtime, "bigint").mockImplementation(() =>
      BigInt(Math.round(performance.now() * 1_000_000)),
    );
    const document = new TestNode("#document", null, 9);
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", {
      document,
      HTMLIFrameElement: TestNode,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    openAccountLifetime("account");
    const heard: Array<Invalidation> = [];
    stops.push(onZeropsInvalidation((invalidation) => heard.push(invalidation)));
    function Clock({ on }: { readonly on: OrganizationRef | null }) {
      useCreationInventoryRefresh(on);
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    act(() => root.render(createElement(Clock, { on: organization })));

    // Each tick is heard when its 250 ms window closes.
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000 + 250));
    const ticks = (5 * 60_000) / CREATION_REFRESH_MS;
    expect(heard).toEqual(
      Array.from({ length: ticks }, () => ({ topic: "inventory", organization })),
    );

    act(() => root.render(createElement(Clock, { on: null })));
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(heard).toHaveLength(ticks);
    act(() => root.unmount());
  });
});
