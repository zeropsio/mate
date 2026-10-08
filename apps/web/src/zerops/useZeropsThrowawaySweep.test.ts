// @effect-diagnostics globalDate:off -- fake timers own `Date.now()`; the sweep and the platform read it.
import { AtomRegistry } from "effect/reactivity";
import { act, createElement, useLayoutEffect } from "react";
import { create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { ZeropsApiError } from "@t3tools/client-runtime/zerops";
import {
  connectThroughThrowaway,
  THROWAWAY_SWEEP_AGE_MS,
  zeropsThrowawayPlatform,
  makeThrowawayDebt,
  type ThrowawayDebt,
} from "@t3tools/client-runtime/zerops/doorThrowaway";

import { openAccountLifetime, closeAccountLifetime } from "./accountLifetime";
import { useZeropsThrowawaySweep } from "./useZeropsThrowawaySweep";

const mock = vi.hoisted(() => ({
  registry: null as AtomRegistry.AtomRegistry | null,
  debt: null as ThrowawayDebt | null,
  /** Every read of an organization's token list, by the organization it asked. */
  reads: [] as Array<string>,
  /** The token list as the platform answers it. */
  tokens: [] as Array<{ tokenId: string; name: string; created: string }>,
  deleted: [] as Array<string>,
}));

vi.mock("./throwawayDebt", () => ({ accountThrowawayDebt: () => mock.debt! }));
vi.mock("./ZeropsSessionProvider", () => {
  const client = {
    listIntegrationTokens: async (clientId: string) => {
      mock.reads.push(clientId);
      return mock.tokens.map(({ tokenId, ...token }) => ({ id: tokenId, ...token }));
    },
    deleteIntegrationToken: async (
      { tokenId }: { readonly tokenId: string },
      _signal?: AbortSignal,
      beforeWrite?: () => Promise<void>,
    ) => {
      await beforeWrite?.();
      mock.deleted.push(tokenId);
    },
  };
  return { useZeropsSession: () => ({ client }) };
});
// The account's operations as its data mount builds them, over a store of the test's registry.
vi.mock("./accountOperations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./accountOperations")>();
  const { makeAccountStore } = await import("@t3tools/client-runtime/data");
  const { useZeropsSession } = await import("./ZeropsSessionProvider");
  const stores = new WeakMap<object, ReturnType<typeof makeAccountStore>>();
  return {
    ...actual,
    useAccountOperations: () => {
      const registry = mock.registry!;
      let store = stores.get(registry);
      if (store === undefined) {
        store = makeAccountStore(registry);
        stores.set(registry, store);
      }
      return actual.accountOperations(
        store,
        registry,
        useZeropsSession().client,
        () => () => {},
        () => {},
        async () => false,
      );
    },
  };
});

let cleanup: ReturnType<typeof useZeropsThrowawaySweep>;

/** The sweep mounted over the organization `clientId`, as the projects page mounts it. */
async function mounted(clientId: string) {
  function Probe() {
    const view = useZeropsThrowawaySweep({ clientId, enabled: true });
    useLayoutEffect(() => {
      cleanup = view;
    }, [view]);
    return null;
  }
  let root: ReturnType<typeof create> | undefined;
  await act(async () => {
    root = create(createElement(Probe));
  });
  // What a load would read settles on the next microtasks.
  await act(async () => {
    await Promise.resolve();
  });
  return root!;
}

describe("useZeropsThrowawaySweep", () => {
  beforeEach(() => {
    openAccountLifetime("ada");
    mock.registry = AtomRegistry.make();
    mock.debt = makeThrowawayDebt();
  });
  afterEach(() => {
    closeAccountLifetime();
    mock.registry?.dispose();
    vi.useRealTimers();
    mock.reads.length = 0;
    mock.deleted.length = 0;
    mock.tokens = [];
  });

  it("a load lists no tokens", async () => {
    const root = await mounted("org-load");
    try {
      expect(mock.reads).toEqual([]);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("a failed door delete stays visible until one manual delete again", async () => {
    vi.useFakeTimers({
      now: Date.parse("2026-10-03T10:00:00.000Z"),
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });
    const root = await mounted("org-left");
    try {
      // A door's throwaway this tab could not delete: Zerops refused the delete.
      const client = {
        accountEpoch: 1,
        mintThrowaway: async () => ({ id: "door-1", token: "a-value", mintingToken: "m" }),
        deleteThrowaway: async () => {
          throw new ZeropsApiError("refused", "forbidden", 403);
        },
      } as unknown as ZeropsApiClient;
      await act(async () => {
        await connectThroughThrowaway({
          platform: zeropsThrowawayPlatform(client, { asked: true, debt: mock.debt! }),
          clientId: "org-left",
          projectId: "p1",
          nonce: "n1",
          connect: async () => "connected",
        });
      });
      mock.tokens = [
        { tokenId: "door-1", name: "mate-door:p1:n1", created: new Date(Date.now()).toISOString() },
      ];
      // Younger than the door's own window it may be any tab's live throwaway: nothing is listed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(THROWAWAY_SWEEP_AGE_MS);
      });
      expect(mock.reads).toEqual([]);
      // Passing the window never retries the failed deletion.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(THROWAWAY_SWEEP_AGE_MS);
      });
      expect([mock.reads, mock.deleted]).toEqual([[], []]);
      expect(cleanup).toMatchObject({ state: "failed", failure: "refused" });
      await act(async () => {
        cleanup.again();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect([mock.reads, mock.deleted]).toEqual([[], ["door-1"]]);
      expect(cleanup.state).toBe("done");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(THROWAWAY_SWEEP_AGE_MS * 3);
      });
      expect(mock.reads).toEqual([]);
      expect(mock.deleted).toEqual(["door-1"]);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
