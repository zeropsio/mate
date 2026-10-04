// @effect-diagnostics globalDate:off -- fake timers own `Date.now()`; the sweep and the platform read it.
import { act, createElement } from "react";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { ZeropsApiError } from "@t3tools/client-runtime/zerops";
import {
  connectThroughThrowaway,
  THROWAWAY_SWEEP_AGE_MS,
  zeropsThrowawayPlatform,
} from "@t3tools/client-runtime/zerops/doorThrowaway";

import { useZeropsThrowawaySweep } from "./useZeropsThrowawaySweep";

const mock = vi.hoisted(() => ({
  /** Every read of an organization's token list, by the organization it asked. */
  reads: [] as Array<string>,
  /** The token list as the platform answers it. */
  tokens: [] as Array<{ tokenId: string; name: string; created: string }>,
  deleted: [] as Array<string>,
}));

vi.mock("./ZeropsSessionProvider", () => {
  const client = {
    deleteIntegrationToken: async ({ tokenId }: { readonly tokenId: string }) => {
      mock.deleted.push(tokenId);
    },
  };
  return { useZeropsSession: () => ({ client }) };
});
vi.mock("./zeropsDataContext", () => {
  const data = {
    organizationRef: (organizationId: string) => ({ organizationId }),
    runtime: { scope: {}, cells: {} },
  };
  return { useZeropsData: () => data };
});
vi.mock("./readZeropsCell", () => ({
  readZeropsCell: async (
    _cells: unknown,
    request: { readonly organization: { organizationId: string } },
  ) => {
    mock.reads.push(request.organization.organizationId);
    return mock.tokens;
  },
}));

/** The sweep mounted over the organization `clientId`, as the projects page mounts it. */
async function mounted(clientId: string) {
  function Probe() {
    useZeropsThrowawaySweep({ clientId, enabled: true });
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
  afterEach(() => {
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

  it("sweeps once after this browser failed a delete", async () => {
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
          platform: zeropsThrowawayPlatform(client, { asked: true }),
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
      // Past it, listed once and taken back; then owed no longer.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(THROWAWAY_SWEEP_AGE_MS);
      });
      expect([mock.reads, mock.deleted]).toEqual([["org-left"], ["door-1"]]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(THROWAWAY_SWEEP_AGE_MS * 3);
      });
      expect(mock.reads).toEqual(["org-left"]);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
